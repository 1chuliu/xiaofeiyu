package com.xiaofeiyu.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // WebView 跨域请求的本地转发代理（127.0.0.1:8788）
    LocalProxy.start();
  }

  @Override
  public void onDestroy() {
    LocalProxy.stop();
    super.onDestroy();
  }
}