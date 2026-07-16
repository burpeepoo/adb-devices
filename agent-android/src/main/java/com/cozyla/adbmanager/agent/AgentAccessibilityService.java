package com.cozyla.adbmanager.agent;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Task-scoped UI inspection and interaction bridge for the desktop Scout runtime. */
public final class AgentAccessibilityService extends AccessibilityService {
  private static final int MAX_NODES = 160;
  private static volatile AgentAccessibilityService activeService;

  @Override
  protected void onServiceConnected() {
    activeService = this;
  }

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    // The desktop side polls explicit snapshots; events only keep the service alive.
  }

  @Override
  public void onInterrupt() {}

  @Override
  public void onDestroy() {
    if (activeService == this) activeService = null;
    super.onDestroy();
  }

  static String snapshotJson() {
    AgentAccessibilityService service = activeService;
    if (service == null) return errorJson("Accessibility service is not enabled");
    AccessibilityNodeInfo root = service.getRootInActiveWindow();
    if (root == null) return errorJson("No active accessibility window is available");
    try {
      List<String> nodes = new ArrayList<>();
      collectNodes(root, nodes);
      DisplayMetrics metrics = service.getResources().getDisplayMetrics();
      StringBuilder body = new StringBuilder("{\"ok\":true,\"source\":\"accessibility\",");
      body.append("\"width\":").append(metrics.widthPixels).append(',');
      body.append("\"height\":").append(metrics.heightPixels).append(',');
      body.append("\"nodes\":[");
      for (int index = 0; index < nodes.size(); index++) {
        if (index > 0) body.append(',');
        body.append(nodes.get(index));
      }
      body.append("]}");
      return body.toString();
    } finally {
      root.recycle();
    }
  }

  static String tapJson(int x, int y) {
    AgentAccessibilityService service = activeService;
    if (service == null) return errorJson("Accessibility service is not enabled");
    AccessibilityNodeInfo root = service.getRootInActiveWindow();
    if (root == null) return errorJson("No active accessibility window is available");
    try {
      AccessibilityNodeInfo target = findSmallestNodeAt(root, x, y, null);
      AccessibilityNodeInfo clickable = clickableParent(target);
      if (clickable != null) {
        boolean accepted = clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        clickable.recycle();
        if (accepted) return actionJson("tap", true, "Clicked accessible node");
      }
      return gestureTapJson(service, x, y);
    } finally {
      root.recycle();
    }
  }

  static String swipeJson(int x1, int y1, int x2, int y2, int durationMs) {
    AgentAccessibilityService service = activeService;
    if (service == null) return errorJson("Accessibility service is not enabled");
    Path path = new Path();
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
    GestureDescription gesture =
        new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, clamp(durationMs, 80, 2000)))
            .build();
    boolean accepted = service.dispatchGesture(gesture, null, null);
    return actionJson("swipe", accepted, accepted ? "Swipe gesture dispatched" : "Swipe gesture was rejected");
  }

  static String backJson() {
    AgentAccessibilityService service = activeService;
    if (service == null) return errorJson("Accessibility service is not enabled");
    boolean accepted = service.performGlobalAction(GLOBAL_ACTION_BACK);
    return actionJson("back", accepted, accepted ? "Back action dispatched" : "Back action was rejected");
  }

  private static String gestureTapJson(AgentAccessibilityService service, int x, int y) {
    Path path = new Path();
    path.moveTo(x, y);
    GestureDescription gesture =
        new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, 80))
            .build();
    boolean accepted = service.dispatchGesture(gesture, null, null);
    return actionJson("tap", accepted, accepted ? "Tap gesture dispatched" : "Tap gesture was rejected");
  }

  private static void collectNodes(AccessibilityNodeInfo node, List<String> nodes) {
    if (nodes.size() >= MAX_NODES) return;
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    CharSequence text = node.getText();
    CharSequence description = node.getContentDescription();
    String resourceId = node.getViewIdResourceName();
    if (node.isVisibleToUser()
        && (node.isClickable()
            || (text != null && text.length() > 0)
            || (description != null && description.length() > 0))) {
      nodes.add(
          "{\"text\":"
              + json(text)
              + ",\"content_desc\":"
              + json(description)
              + ",\"resource_id\":"
              + json(resourceId)
              + ",\"class_name\":"
              + json(node.getClassName())
              + ",\"bounds\":"
              + json("[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]")
              + ",\"clickable\":"
              + node.isClickable()
              + ",\"enabled\":"
              + node.isEnabled()
              + "}");
    }
    for (int index = 0; index < node.getChildCount() && nodes.size() < MAX_NODES; index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child == null) continue;
      try {
        collectNodes(child, nodes);
      } finally {
        child.recycle();
      }
    }
  }

  private static AccessibilityNodeInfo findSmallestNodeAt(
      AccessibilityNodeInfo node, int x, int y, AccessibilityNodeInfo best) {
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    if (!bounds.contains(x, y)) return best;
    int bestArea = area(best);
    if (node.isVisibleToUser() && (best == null || area(bounds) <= bestArea)) {
      if (best != null) best.recycle();
      best = AccessibilityNodeInfo.obtain(node);
    }
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child == null) continue;
      try {
        best = findSmallestNodeAt(child, x, y, best);
      } finally {
        child.recycle();
      }
    }
    return best;
  }

  private static AccessibilityNodeInfo clickableParent(AccessibilityNodeInfo node) {
    AccessibilityNodeInfo current = node;
    while (current != null) {
      if (current.isClickable() && current.isEnabled()) return current;
      AccessibilityNodeInfo parent = current.getParent();
      current.recycle();
      current = parent;
    }
    return null;
  }

  private static int area(AccessibilityNodeInfo node) {
    if (node == null) return Integer.MAX_VALUE;
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    return area(bounds);
  }

  private static int area(Rect bounds) {
    return Math.max(1, bounds.width()) * Math.max(1, bounds.height());
  }

  private static int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private static String actionJson(String action, boolean ok, String message) {
    return "{\"ok\":" + ok + ",\"action\":\"" + action + "\",\"message\":" + json(message) + "}";
  }

  private static String errorJson(String message) {
    return "{\"ok\":false,\"error\":" + json(message) + "}";
  }

  private static String json(CharSequence value) {
    String string = value == null ? "" : value.toString();
    return JSONObject.quote(string);
  }
}
