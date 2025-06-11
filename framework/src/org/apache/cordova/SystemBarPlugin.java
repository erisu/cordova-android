/*
       Licensed to the Apache Software Foundation (ASF) under one
       or more contributor license agreements.  See the NOTICE file
       distributed with this work for additional information
       regarding copyright ownership.  The ASF licenses this file
       to you under the Apache License, Version 2.0 (the
       "License"); you may not use this file except in compliance
       with the License.  You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

       Unless required by applicable law or agreed to in writing,
       software distributed under the License is distributed on an
       "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
       KIND, either express or implied.  See the License for the
       specific language governing permissions and limitations
       under the License.
*/

package org.apache.cordova;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewParent;
import android.view.Window;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class SystemBarPlugin extends CordovaPlugin {
    static final String PLUGIN_NAME = "CordovaSystemBarPlugin";

    // Internal variables
    private Context context;
    private Resources resources;
    private int statusBarBackgroundColor;
    private int rootViewBackgroundColor;

    @Override
    protected void pluginInitialize() {
        context = cordova.getContext();
        resources = context.getResources();
    }

    private void updateSystemBars() {
        Window window = cordova.getActivity().getWindow();

        statusBarBackgroundColor = getStatusBarBackgroundColor();
        rootViewBackgroundColor = getPreferenceBackgroundColor();

        if (!preferences.getBoolean("AndroidEdgeToEdge", false)) {
            View statusBar = getStatusBarView(webView);
            if (statusBar != null) {
                statusBar.setBackgroundColor(statusBarBackgroundColor);
            }
        }

        // Set the root view's background color. Works on SDK 36+
        View root = cordova.getActivity().findViewById(android.R.id.content);
        if (root != null) {
            root.setBackgroundColor(rootViewBackgroundColor);
        }

        // Automatically set the font and icon color of the system bars based on background color.
        boolean isStatusBarBackgroundColorLight = isColorLight(statusBarBackgroundColor);
        boolean isBackgroundColorLight = isColorLight(rootViewBackgroundColor);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
                if (isBackgroundColorLight) {
                    controller.setSystemBarsAppearance(0, appearance);
                } else {
                    controller.setSystemBarsAppearance(appearance, appearance);
                }
            }
        }
        WindowInsetsControllerCompat controllerCompat = WindowCompat.getInsetsController(window, window.getDecorView());
        controllerCompat.setAppearanceLightStatusBars(isStatusBarBackgroundColorLight);
        controllerCompat.setAppearanceLightNavigationBars(isBackgroundColorLight);

        // Allow custom background color for StatusBar.
        window.setStatusBarColor(statusBarBackgroundColor);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Allow custom background color for SDK 26 and greater.
            window.setNavigationBarColor(rootViewBackgroundColor);
        } else {
            // Force navigation bar to black for SDK 25 and less.
            window.setNavigationBarColor(Color.BLACK);
        }
    }

    private static boolean isColorLight(int color) {
        double r = Color.red(color) / 255.0;
        double g = Color.green(color) / 255.0;
        double b = Color.blue(color) / 255.0;
        double luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance > 0.5;
    }

    private int getStatusBarBackgroundColor() {
        if (preferences.contains("StatusBarBackgroundColor")) {
            return getPreferenceStatusBarBackgroundColor();
        } else if(preferences.contains("BackgroundColor")){
            return getPreferenceBackgroundColor();
        } else {
            return getUiModeColor();
        }
    }

    private int getPreferenceStatusBarBackgroundColor() {
        int fallback = getUiModeColor();
        try {
            String colorString = preferences.getString("StatusBarBackgroundColor", null);
            if (colorString == null) {
                return fallback;
            }
            return Color.parseColor(colorString);
        } catch (IllegalArgumentException ignore) {
            LOG.e(PLUGIN_NAME, "Invalid hex string argument, use f.i. '#999999'");
            return fallback;
        }
    }

    private int getPreferenceBackgroundColor() {
        int fallback = getUiModeColor();
        try {
            return preferences.getInteger("BackgroundColor", fallback);
        } catch (NumberFormatException e) {
            e.printStackTrace();
            return fallback;
        }
    }

    private View getStatusBarView(CordovaWebView webView) {
        ViewParent parent = webView.getView().getParent();
        if (parent instanceof FrameLayout) {
            FrameLayout frameLayout = (FrameLayout) parent;

            for (int i = 0; i < frameLayout.getChildCount(); i++) {
                View child = frameLayout.getChildAt(i);
                Object tag = child.getTag();
                if ("statusBarView".equals(tag)) {
                    return child;
                }
            }
        }
        return null;
    }

    private int getUiModeColor() {
        // Hardcoded fallback values matches system ui values (R.color) which were added in SDK 34.
        return isNightMode()
                ? getThemeColor("cdv_background_color_dark", "#121318")
                : getThemeColor("cdv_background_color_light", "#FAF8FF");
    }

    private boolean isNightMode() {
        return (resources.getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressLint("DiscouragedApi")
    private int getThemeColor(String colorKey, String fallbackColor) {
        int colorResId =resources.getIdentifier(colorKey, "color", context.getPackageName());
        return colorResId != 0
                ? ContextCompat.getColor(context, colorResId)
                : Color.parseColor(fallbackColor);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        cordova.getActivity().runOnUiThread(this::updateSystemBars);
    }

    @Override
    public void onResume(boolean multitasking) {
        super.onResume(multitasking);
        cordova.getActivity().runOnUiThread(this::updateSystemBars);
    }

    @Override
    public Object onMessage(String id, Object data) {
        if (id.equals("updateSystemBars")) {
            cordova.getActivity().runOnUiThread(this::updateSystemBars);
        }
        return null;
    }
}
