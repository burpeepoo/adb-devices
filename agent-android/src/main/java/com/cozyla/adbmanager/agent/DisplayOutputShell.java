package com.cozyla.adbmanager.agent;

import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import java.lang.reflect.Method;
import java.util.Locale;

public final class DisplayOutputShell {
  private static final String SERVICE_NAME = "vendor.display.output.IDisplayOutputManager/default";
  private static final String DESCRIPTOR = "vendor.display.output.IDisplayOutputManager";

  private static final int TX_GET_ENHANCE_COMPONENT = 24;
  private static final int TX_SET_ENHANCE_COMPONENT = 25;
  private static final int TX_GET_SMART_BACKLIGHT = 26;
  private static final int TX_SET_SMART_BACKLIGHT = 27;
  private static final int TX_GET_READING_MODE = 28;
  private static final int TX_SET_READING_MODE = 29;
  private static final int TX_GET_COLOR_TEMPERATURE = 30;
  private static final int TX_SET_COLOR_TEMPERATURE = 31;
  private static final int TX_GET_BLACK_WHITE_MODE = 41;
  private static final int TX_SET_BLACK_WHITE_MODE = 42;

  private DisplayOutputShell() {}

  public static void main(String[] args) {
    try {
      if (args.length == 0) {
        throw new IllegalArgumentException("operation is required");
      }
      String operation = args[0];
      Result result = run(operation, args);
      System.out.println(result.toJson(operation));
    } catch (Throwable error) {
      System.out.println(errorJson(error));
      System.exit(2);
    }
  }

  private static Result run(String operation, String[] args) throws Exception {
    if ("getEnhanceComponent".equals(operation)) {
      requireArgs(args, 3);
      return transactInt(TX_GET_ENHANCE_COMPONENT, intArg(args[1], "displayId"), intArg(args[2], "component"));
    }
    if ("setEnhanceComponent".equals(operation)) {
      requireArgs(args, 4);
      return transactInt(
          TX_SET_ENHANCE_COMPONENT,
          intArg(args[1], "displayId"),
          intArg(args[2], "component"),
          intArg(args[3], "value"));
    }
    if ("getSmartBacklight".equals(operation)) {
      requireArgs(args, 2);
      return transactInt(TX_GET_SMART_BACKLIGHT, intArg(args[1], "displayId"));
    }
    if ("setSmartBacklight".equals(operation)) {
      requireArgs(args, 3);
      return transactInt(TX_SET_SMART_BACKLIGHT, intArg(args[1], "displayId"), intArg(args[2], "value"));
    }
    if ("getColorTemperature".equals(operation)) {
      requireArgs(args, 2);
      return transactInt(TX_GET_COLOR_TEMPERATURE, intArg(args[1], "displayId"));
    }
    if ("setColorTemperature".equals(operation)) {
      requireArgs(args, 3);
      return transactInt(TX_SET_COLOR_TEMPERATURE, intArg(args[1], "displayId"), intArg(args[2], "value"));
    }
    if ("getBlackWhiteMode".equals(operation)) {
      requireArgs(args, 2);
      return transactBoolean(TX_GET_BLACK_WHITE_MODE, intArg(args[1], "displayId"));
    }
    if ("setBlackWhiteMode".equals(operation)) {
      requireArgs(args, 3);
      return transactInt(TX_SET_BLACK_WHITE_MODE, intArg(args[1], "displayId"), booleanArg(args[2], "enabled"));
    }
    if ("getReadingMode".equals(operation)) {
      requireArgs(args, 2);
      return transactBoolean(TX_GET_READING_MODE, intArg(args[1], "displayId"));
    }
    if ("setReadingMode".equals(operation)) {
      requireArgs(args, 3);
      return transactInt(TX_SET_READING_MODE, intArg(args[1], "displayId"), booleanArg(args[2], "enabled"));
    }
    throw new IllegalArgumentException("unsupported operation: " + operation);
  }

  private static Result transactInt(int code, Object... values) throws Exception {
    Parcel reply = transact(code, values);
    try {
      reply.readException();
      return Result.number(reply.readInt());
    } finally {
      reply.recycle();
    }
  }

  private static Result transactBoolean(int code, Object... values) throws Exception {
    Parcel reply = transact(code, values);
    try {
      reply.readException();
      return Result.bool(reply.readBoolean());
    } finally {
      reply.recycle();
    }
  }

  private static Parcel transact(int code, Object... values) throws Exception {
    IBinder binder = displayService();
    Parcel data = Parcel.obtain();
    Parcel reply = Parcel.obtain();
    try {
      data.writeInterfaceToken(DESCRIPTOR);
      for (Object value : values) {
        if (value instanceof Boolean) {
          data.writeBoolean(((Boolean) value).booleanValue());
        } else {
          data.writeInt(((Integer) value).intValue());
        }
      }
      boolean handled = binder.transact(code, data, reply, 0);
      if (!handled) {
        throw new RemoteException("transaction " + code + " was not handled");
      }
      return reply;
    } catch (Exception error) {
      reply.recycle();
      throw error;
    } finally {
      data.recycle();
    }
  }

  private static IBinder displayService() throws Exception {
    Class<?> serviceManager = Class.forName("android.os.ServiceManager");
    IBinder binder = null;
    try {
      Method waitForDeclaredService = serviceManager.getDeclaredMethod("waitForDeclaredService", String.class);
      binder = (IBinder) waitForDeclaredService.invoke(null, SERVICE_NAME);
    } catch (NoSuchMethodException ignored) {
      // Older platform API; fall through to getService.
    }
    if (binder == null) {
      Method getService = serviceManager.getDeclaredMethod("getService", String.class);
      binder = (IBinder) getService.invoke(null, SERVICE_NAME);
    }
    if (binder == null) {
      throw new IllegalStateException("display output service not found: " + SERVICE_NAME);
    }
    return binder;
  }

  private static void requireArgs(String[] args, int count) {
    if (args.length != count) {
      throw new IllegalArgumentException(
          String.format(Locale.US, "%s requires %d argument(s), got %d", args[0], count - 1, args.length - 1));
    }
  }

  private static int intArg(String value, String label) {
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException error) {
      throw new IllegalArgumentException("invalid " + label + ": " + value);
    }
  }

  private static boolean booleanArg(String value, String label) {
    if ("1".equals(value) || "true".equalsIgnoreCase(value) || "on".equalsIgnoreCase(value)) {
      return true;
    }
    if ("0".equals(value) || "false".equalsIgnoreCase(value) || "off".equalsIgnoreCase(value)) {
      return false;
    }
    throw new IllegalArgumentException("invalid " + label + ": " + value);
  }

  private static String errorJson(Throwable error) {
    String name = error.getClass().getSimpleName();
    String message = error.getMessage() == null ? name : error.getMessage();
    return "{\"ok\":false,\"error\":\"" + escapeJson(name + ": " + message) + "\"}";
  }

  private static String escapeJson(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
  }

  private static final class Result {
    private final Integer number;
    private final Boolean bool;

    private Result(Integer number, Boolean bool) {
      this.number = number;
      this.bool = bool;
    }

    static Result number(int value) {
      return new Result(Integer.valueOf(value), null);
    }

    static Result bool(boolean value) {
      return new Result(null, Boolean.valueOf(value));
    }

    String toJson(String operation) {
      if (bool != null) {
        return "{\"ok\":true,\"operation\":\""
            + escapeJson(operation)
            + "\",\"value\":"
            + bool.booleanValue()
            + "}";
      }
      return "{\"ok\":true,\"operation\":\""
          + escapeJson(operation)
          + "\",\"value\":"
          + number.intValue()
          + "}";
    }
  }
}
