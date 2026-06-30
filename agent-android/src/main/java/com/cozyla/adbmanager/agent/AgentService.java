package com.cozyla.adbmanager.agent;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.net.TrafficStats;
import android.os.Build;
import android.os.Debug;
import android.os.IBinder;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

public final class AgentService extends Service {
  private static final String TAG = "AdbManagerAgent";
  private static final String SOCKET_NAME = "adb_manager_agent";
  private static final String CHANNEL_ID = "adb_manager_agent";
  private static final int PROTOCOL_VERSION = 1;
  private static final String AGENT_VERSION = "0.1.0";

  private final AtomicBoolean running = new AtomicBoolean(false);
  private volatile String targetPackage = "";
  private volatile long sampleIntervalMs = 1000;
  private long startedAtMs;
  private LocalServerSocket serverSocket;
  private Thread serverThread;

  @Override
  public void onCreate() {
    super.onCreate();
    startedAtMs = System.currentTimeMillis();
    startForeground(1001, buildNotification());
    startServer();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (!running.get()) {
      startServer();
    }
    return START_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public void onDestroy() {
    running.set(false);
    try {
      if (serverSocket != null) serverSocket.close();
    } catch (IOException ignored) {
    }
    super.onDestroy();
  }

  private void startServer() {
    if (!running.compareAndSet(false, true)) return;
    serverThread =
        new Thread(
            new Runnable() {
              @Override
              public void run() {
                serve();
              }
            },
            "adb-manager-agent");
    serverThread.start();
  }

  private void serve() {
    try {
      serverSocket = new LocalServerSocket(SOCKET_NAME);
      while (running.get()) {
        LocalSocket socket = serverSocket.accept();
        final LocalSocket clientSocket = socket;
        new Thread(
                new Runnable() {
                  @Override
                  public void run() {
                    handleSocket(clientSocket);
                  }
                },
                "adb-manager-agent-client")
            .start();
      }
    } catch (IOException ignored) {
      Log.w(TAG, "Agent socket server stopped", ignored);
      running.set(false);
    }
  }

  private void handleSocket(LocalSocket socket) {
    try (
        LocalSocket closeable = socket;
        BufferedReader reader =
            new BufferedReader(new InputStreamReader(closeable.getInputStream(), StandardCharsets.UTF_8));
        BufferedWriter writer =
            new BufferedWriter(new OutputStreamWriter(closeable.getOutputStream(), StandardCharsets.UTF_8))) {
      String requestLine = reader.readLine();
      if (requestLine == null) return;
      int contentLength = 0;
      String line;
      while ((line = reader.readLine()) != null && !line.isEmpty()) {
        String lower = line.toLowerCase(Locale.US);
        if (lower.startsWith("content-length:")) {
          contentLength = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
        }
      }
      char[] body = new char[Math.max(0, contentLength)];
      if (contentLength > 0) reader.read(body);

      if (requestLine.startsWith("GET /health ")) {
        writeJson(writer, healthJson());
      } else if (requestLine.startsWith("POST /target ")) {
        updateTarget(new String(body));
        writeJson(writer, "{\"ok\":true}");
      } else if (requestLine.startsWith("GET /samples/stream ")) {
        writeStream(writer);
      } else if (requestLine.startsWith("POST /stop ")) {
        writeJson(writer, "{\"ok\":true}");
        stopSelf();
      } else {
        writeNotFound(writer);
      }
    } catch (Exception error) {
      Log.w(TAG, "Agent request failed", error);
    }
  }

  private void updateTarget(String body) {
    String packageName = jsonString(body, "target_package");
    if (packageName != null) targetPackage = packageName;
    Long interval = jsonLong(body, "interval_ms");
    if (interval != null) sampleIntervalMs = Math.max(500, Math.min(5000, interval));
  }

  private void writeStream(BufferedWriter writer) throws IOException {
    writer.write("HTTP/1.1 200 OK\r\n");
    writer.write("Content-Type: application/x-ndjson\r\n");
    writer.write("Connection: close\r\n\r\n");
    writer.flush();
    while (running.get()) {
      writer.write(sampleJson());
      writer.write("\n");
      writer.flush();
      SystemClock.sleep(sampleIntervalMs);
    }
  }

  private String healthJson() {
    boolean usageAccess = hasUsageStatsAccess();
    String status = usageAccess ? "connected" : "permission_limited";
    return "{"
        + "\"agent_version\":\"" + AGENT_VERSION + "\","
        + "\"protocol_version\":" + PROTOCOL_VERSION + ","
        + "\"started_at_ms\":" + startedAtMs + ","
        + "\"device_time_ms\":" + System.currentTimeMillis() + ","
        + "\"status\":\"" + status + "\","
        + "\"permissions\":{\"usage_stats\":" + usageAccess + "},"
        + "\"message\":\"" + (usageAccess ? "connected" : "usage stats permission limited") + "\""
        + "}";
  }

  private String sampleJson() {
    Debug.MemoryInfo memoryInfo = new Debug.MemoryInfo();
    Debug.getMemoryInfo(memoryInfo);
    int threadCount = Thread.getAllStackTraces().size();
    String foregroundPackage = foregroundPackage();
    long rx = TrafficStats.getUidRxBytes(Process.myUid());
    long tx = TrafficStats.getUidTxBytes(Process.myUid());
    String packageName = targetPackage.isEmpty() ? foregroundPackage : targetPackage;
    return "{"
        + "\"timestamp_ms\":" + System.currentTimeMillis() + ","
        + "\"sample_source\":\"agent\","
        + "\"agent_status\":\"" + (hasUsageStatsAccess() ? "connected" : "permission_limited") + "\","
        + "\"target_package\":" + jsonNullable(packageName) + ","
        + "\"foreground_package\":" + jsonNullable(foregroundPackage) + ","
        + "\"pid\":" + Process.myPid() + ","
        + "\"process\":{\"package_name\":" + jsonNullable(packageName) + ","
        + "\"pid\":" + Process.myPid() + ","
        + "\"rss_kb\":" + memoryInfo.getTotalPss() + ","
        + "\"pss_kb\":" + memoryInfo.getTotalPss() + ","
        + "\"thread_count\":" + threadCount + ","
        + "\"running\":true},"
        + "\"network\":{\"rx_bytes\":" + rx + ",\"tx_bytes\":" + tx + "},"
        + "\"unavailable\":[\"ordinary APK cannot read system GPU counters\"]"
        + "}";
  }

  private boolean hasUsageStatsAccess() {
    UsageStatsManager manager = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
    if (manager == null) return false;
    long now = System.currentTimeMillis();
    List<UsageStats> stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 60_000, now);
    return stats != null && !stats.isEmpty();
  }

  private String foregroundPackage() {
    UsageStatsManager manager = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
    if (manager == null) return "";
    long now = System.currentTimeMillis();
    List<UsageStats> stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 60_000, now);
    if (stats == null || stats.isEmpty()) return "";
    UsageStats latest = null;
    for (UsageStats stat : stats) {
      if (latest == null || stat.getLastTimeUsed() > latest.getLastTimeUsed()) latest = stat;
    }
    return latest == null ? "" : latest.getPackageName();
  }

  private Notification buildNotification() {
    NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26 && manager != null) {
      manager.createNotificationChannel(
          new NotificationChannel(CHANNEL_ID, "ADB Manager Agent", NotificationManager.IMPORTANCE_LOW));
      return new Notification.Builder(this, CHANNEL_ID)
          .setContentTitle("ADB Manager Agent")
          .setContentText("Performance sampling bridge is active")
          .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
          .build();
    }
    return new Notification.Builder(this)
        .setContentTitle("ADB Manager Agent")
        .setContentText("Performance sampling bridge is active")
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .build();
  }

  private static void writeJson(BufferedWriter writer, String body) throws IOException {
    writer.write("HTTP/1.1 200 OK\r\n");
    writer.write("Content-Type: application/json\r\n");
    writer.write("Content-Length: " + body.getBytes(StandardCharsets.UTF_8).length + "\r\n");
    writer.write("Connection: close\r\n\r\n");
    writer.write(body);
    writer.flush();
  }

  private static void writeNotFound(BufferedWriter writer) throws IOException {
    String body = "{\"ok\":false,\"error\":\"not found\"}";
    writer.write("HTTP/1.1 404 Not Found\r\n");
    writer.write("Content-Type: application/json\r\n");
    writer.write("Content-Length: " + body.length() + "\r\n");
    writer.write("Connection: close\r\n\r\n");
    writer.write(body);
    writer.flush();
  }

  private static String jsonNullable(String value) {
    return value == null || value.isEmpty() ? "null" : "\"" + escape(value) + "\"";
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String jsonString(String body, String key) {
    String marker = "\"" + key + "\":\"";
    int start = body.indexOf(marker);
    if (start < 0) return null;
    start += marker.length();
    int end = body.indexOf('"', start);
    return end < 0 ? null : body.substring(start, end);
  }

  private static Long jsonLong(String body, String key) {
    String marker = "\"" + key + "\":";
    int start = body.indexOf(marker);
    if (start < 0) return null;
    start += marker.length();
    int end = start;
    while (end < body.length() && Character.isDigit(body.charAt(end))) end++;
    if (end == start) return null;
    return Long.parseLong(body.substring(start, end));
  }
}
