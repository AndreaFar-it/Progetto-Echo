package com.echo.app;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // REQUIRED for @capgo/camera-preview (toBack: true).
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
