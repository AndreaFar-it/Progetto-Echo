package com.echo.app;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // REQUIRED for @capacitor-community/camera-preview (toBack: true).
        // The native camera surface renders BELOW the WebView; without a
        // transparent WebView background it is fully hidden behind Ionic's
        // default opaque page background, even though capture still works.
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
