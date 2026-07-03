package com.cozyla.adbmanager.agent;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

public final class AgentAccessibilityService extends AccessibilityService {
  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    // The desktop app owns task policy. This service only makes user-approved
    // accessibility access available to the Agent APK.
  }

  @Override
  public void onInterrupt() {}
}
