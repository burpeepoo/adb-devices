package com.cozyla.adbmanager.agent;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

public final class AgentBootstrapActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Intent intent = new Intent(this, AgentService.class);
    if (Build.VERSION.SDK_INT >= 26) {
      startForegroundService(intent);
    } else {
      startService(intent);
    }
    finish();
    overridePendingTransition(0, 0);
  }
}
