const fs = require('fs');
const path = require('path');
const { AndroidConfig, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function getAndroidPackage(config) {
  const androidPackage = config.android?.package;
  if (!androidPackage) {
    throw new Error('Trust overlay plugin requires expo.android.package to be set.');
  }
  return androidPackage;
}

function patchMainApplication(contents, androidPackage, language) {
  const overlayPackageName = `${androidPackage}.overlay`;
  const importLine = `import ${overlayPackageName}.TrustOverlayPackage${language === 'java' ? ';' : ''}`;
  const packageLineRegex = /^package\s+[\w.]+;?$/m;

  if (!contents.includes(importLine)) {
    contents = contents.replace(packageLineRegex, (match) => `${match}\n\n${importLine}`);
  }

  const packageAddLine = language === 'java'
    ? 'packages.add(new TrustOverlayPackage());'
    : 'packages.add(TrustOverlayPackage())';
  const applyAddLine = 'add(TrustOverlayPackage())';

  if (!contents.includes(packageAddLine) && !contents.includes(applyAddLine)) {
    const nextContents = contents.replace(
      /^(\s*)return packages\s*$/m,
      (_match, indent) => `${indent}${packageAddLine}\n${indent}return packages`
    );
    if (nextContents !== contents) {
      contents = nextContents;
    } else if (language !== 'java') {
      let kotlinContents = contents.replace(
        /^(\s*.*PackageList\(this\)\.packages\.apply\s*\{\s*)$/m,
        (_match, line) => `${line}\n${line.match(/^\s*/)[0]}  ${applyAddLine}`
      );

      if (kotlinContents === contents) {
        kotlinContents = contents.replace(
          /^(\s*)override fun getPackages\(\):\s*(?:Mutable)?List<ReactPackage>\s*=\s*PackageList\(this\)\.packages\s*$/m,
          (_match, indent) => `${indent}override fun getPackages(): List<ReactPackage> =\n${indent}  PackageList(this).packages.apply {\n${indent}    ${applyAddLine}\n${indent}  }`
        );
      }

      if (kotlinContents === contents) {
        kotlinContents = contents.replace(
          /^(\s*)return PackageList\(this\)\.packages\s*$/m,
          (_match, indent) => `${indent}val packages = PackageList(this).packages\n${indent}${packageAddLine}\n${indent}return packages`
        );
      }

      contents = kotlinContents;
    } else if (language === 'java') {
      contents = contents.replace(
        /^(\s*)return new PackageList\(this\)\.getPackages\(\);$/m,
        (_match, indent) => `${indent}List<ReactPackage> packages = new PackageList(this).getPackages();\n${indent}${packageAddLine}\n${indent}return packages;`
      );
    }
  }

  if (!contents.includes(packageAddLine) && !contents.includes(applyAddLine)) {
    throw new Error('Trust overlay plugin could not register TrustOverlayPackage in MainApplication.');
  }

  return contents;
}

function overlayModuleSource(androidPackage) {
  return `package ${androidPackage}.overlay;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.AnimationSet;
import android.view.animation.ScaleAnimation;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class TrustOverlayModule extends ReactContextBaseJavaModule implements LifecycleEventListener {
  private static final String TAG = "TrustOverlay";
  private final ReactApplicationContext reactContext;
  private WindowManager windowManager;
  private View overlayView;
  private WindowManager.LayoutParams layoutParams;
  private String currentVariant = "";
  private String currentRideRequestId = "";
  private String currentPickupLabel = "";
  private String currentDropoffLabel = "";
  private String currentFareLabel = "";
  private String currentTitle = "New ride request";
  private String currentBody = "A new ride request has arrived.";

  private int initialX;
  private int initialY;
  private float initialTouchX;
  private float initialTouchY;
  private long touchStartedAt;
  private long overlayCreatedAt;

  public TrustOverlayModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    this.reactContext.addLifecycleEventListener(this);
    Log.d(TAG, "TrustOverlayModule initialized");
  }

  @NonNull
  @Override
  public String getName() {
    return "TrustOverlay";
  }

  private int dp(float value) {
    return Math.round(value * reactContext.getResources().getDisplayMetrics().density);
  }

  private boolean canDrawOverlaysInternal() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactContext);
  }

  private String getMapString(ReadableMap map, String key, String fallback) {
    if (map != null && map.hasKey(key) && !map.isNull(key)) {
      return map.getString(key);
    }
    return fallback;
  }

  private String getVariant(ReadableMap config) {
    String variant = getMapString(config, "variant", "online").trim().toLowerCase();
    if (variant.equals("request")) return "request";
    if (variant.equals("trip")) return "trip";
    return "online";
  }

  private void rememberRequestConfig(ReadableMap config) {
    currentTitle = getMapString(config, "title", "New ride request");
    currentBody = getMapString(config, "subtitle", getMapString(config, "body", "A new ride request has arrived."));
    currentPickupLabel = getMapString(config, "pickupLabel", "");
    currentDropoffLabel = getMapString(config, "dropoffLabel", "");
    currentFareLabel = getMapString(config, "fareLabel", "");
    currentRideRequestId = getMapString(config, "rideRequestId", "");
  }

  private void emitAction(String action) {
    try {
      WritableMap payload = Arguments.createMap();
      payload.putString("action", action);
      payload.putString("rideRequestId", currentRideRequestId == null ? "" : currentRideRequestId);
      payload.putString("pickupLabel", currentPickupLabel == null ? "" : currentPickupLabel);
      payload.putString("dropoffLabel", currentDropoffLabel == null ? "" : currentDropoffLabel);
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit("TrustOverlayRideAction", payload);
    } catch (Exception error) {
      Log.e(TAG, "emitAction failed", error);
    }
  }

  private void openAppWithAction(String action) {
    Intent launchIntent = reactContext.getPackageManager().getLaunchIntentForPackage(reactContext.getPackageName());
    if (launchIntent == null) return;
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    String deepLink = "trustexpress://driver/incoming-ride";
    String query = "";
    if (currentRideRequestId != null && currentRideRequestId.trim().length() > 0) {
      query += "rideRequestId=" + Uri.encode(currentRideRequestId.trim());
      launchIntent.putExtra("rideRequestId", currentRideRequestId.trim());
    }
    if (action != null && action.trim().length() > 0) {
      if (query.length() > 0) query += "&";
      query += "action=" + Uri.encode(action.trim());
    }
    if (query.length() > 0) {
      deepLink = deepLink + "?" + query;
    }
    launchIntent.setData(Uri.parse(deepLink));
    launchIntent.putExtra("openIncomingRideOverlay", true);
    if (action != null) launchIntent.putExtra("overlayAction", action);
    reactContext.startActivity(launchIntent);
  }

  private GradientDrawable roundedRect(String fillColor, float radiusDp) {
    GradientDrawable background = new GradientDrawable();
    background.setColor(Color.parseColor(fillColor));
    background.setCornerRadius(dp(radiusDp));
    return background;
  }

  private TextView createLabel(String text, int sizeSp, String color, boolean bold) {
    TextView view = new TextView(reactContext);
    view.setText(text == null ? "" : text);
    view.setTextSize(sizeSp);
    view.setTextColor(Color.parseColor(color));
    if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
    return view;
  }

  private Button createActionButton(String label, String fillColor, String textColor, final String action) {
    Button button = new Button(reactContext);
    button.setText(label);
    button.setAllCaps(false);
    button.setTextColor(Color.parseColor(textColor));
    button.setBackground(roundedRect(fillColor, 14));
    button.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View view) {
        emitAction(action);
        if ("decline".equals(action)) {
          // Collapse back to online bubble immediately for feedback.
          applyVariant("online", null);
        } else {
          openAppWithAction(action);
        }
      }
    });
    return button;
  }

  private View createRequestCard() {
    LinearLayout card = new LinearLayout(reactContext);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(18), dp(18), dp(18), dp(18));
    card.setBackground(roundedRect("#111827", 24));
    card.setElevation(dp(14));

    FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT
    );
    card.setLayoutParams(cardParams);

    card.addView(createLabel("Trust Express", 12, "#93C5FD", true));
    TextView title = createLabel(currentTitle == null || currentTitle.isEmpty() ? "New ride request" : currentTitle, 20, "#FFFFFF", true);
    title.setPadding(0, dp(8), 0, dp(6));
    card.addView(title);

    String bodyText = currentBody;
    if ((bodyText == null || bodyText.trim().isEmpty()) && (currentPickupLabel.length() > 0 || currentDropoffLabel.length() > 0)) {
      bodyText = (currentPickupLabel.length() > 0 ? currentPickupLabel : "Pickup")
        + " to "
        + (currentDropoffLabel.length() > 0 ? currentDropoffLabel : "Drop-off");
    }
    TextView body = createLabel(bodyText == null ? "A new ride request has arrived." : bodyText, 14, "#E5E7EB", false);
    body.setPadding(0, 0, 0, dp(10));
    card.addView(body);

    if (currentPickupLabel != null && currentPickupLabel.length() > 0) {
      card.addView(createLabel("From: " + currentPickupLabel, 13, "#D1D5DB", false));
    }
    if (currentDropoffLabel != null && currentDropoffLabel.length() > 0) {
      TextView dropoff = createLabel("To: " + currentDropoffLabel, 13, "#D1D5DB", false);
      dropoff.setPadding(0, dp(4), 0, 0);
      card.addView(dropoff);
    }
    if (currentFareLabel != null && currentFareLabel.length() > 0) {
      TextView fare = createLabel(currentFareLabel, 16, "#FFFFFF", true);
      fare.setPadding(0, dp(10), 0, 0);
      card.addView(fare);
    }

    LinearLayout actions = new LinearLayout(reactContext);
    actions.setOrientation(LinearLayout.HORIZONTAL);
    actions.setPadding(0, dp(16), 0, 0);
    actions.setGravity(Gravity.CENTER_VERTICAL);

    LinearLayout.LayoutParams declineParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
    declineParams.setMargins(0, 0, dp(8), 0);
    Button decline = createActionButton("Decline", "#374151", "#FFFFFF", "decline");
    decline.setLayoutParams(declineParams);
    actions.addView(decline);

    LinearLayout.LayoutParams acceptParams = new LinearLayout.LayoutParams(0, dp(48), 1.2f);
    acceptParams.setMargins(dp(8), 0, 0, 0);
    Button accept = createActionButton("Accept", "#206EFF", "#FFFFFF", "accept");
    accept.setLayoutParams(acceptParams);
    actions.addView(accept);

    card.addView(actions);

    Button openApp = createActionButton("Open app", "#1F2937", "#E5E7EB", "open");
    LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(44)
    );
    openParams.setMargins(0, dp(10), 0, 0);
    openApp.setLayoutParams(openParams);
    card.addView(openApp);

    return card;
  }

  private void renderBubble(FrameLayout container, String variant) {
    container.removeAllViews();

    if (variant.equals("trip")) {
      container.addView(createPulseRing(94, "#66F97316", 1.58f, 0.52f, 0.08f, 920, 0));
      container.addView(createPulseRing(74, "#88FB923C", 1.34f, 0.42f, 0.10f, 920, 160));
      container.addView(createCenterCircle("#F97316", "#FFEDD5", 66));
      container.addView(createBadge("#FFFFFF", "#F97316", 18, 18, 18));
      return;
    }

    if (variant.equals("request")) {
      container.addView(createRequestCard());
      return;
    }

    container.addView(createPulseRing(86, "#33206EFF", 1.28f, 0.32f, 0.04f, 1600, 0));
    container.addView(createPulseRing(70, "#55206EFF", 1.18f, 0.26f, 0.06f, 1600, 420));
    container.addView(createCenterCircle("#206EFF", "#E8F0FF", 58));
  }

  private void applyLayoutForVariant(String variant) {
    if (layoutParams == null || windowManager == null || overlayView == null) return;

    boolean isRequest = "request".equals(variant);
    layoutParams.width = isRequest
      ? WindowManager.LayoutParams.MATCH_PARENT
      : WindowManager.LayoutParams.WRAP_CONTENT;
    layoutParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
    layoutParams.gravity = isRequest ? (Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL) : (Gravity.TOP | Gravity.START);
    layoutParams.x = isRequest ? 0 : dp(16);
    layoutParams.y = isRequest ? dp(24) : dp(120);
    layoutParams.flags = isRequest
      ? (WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN)
      : WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;

    try {
      windowManager.updateViewLayout(overlayView, layoutParams);
    } catch (Exception error) {
      Log.e(TAG, "applyLayoutForVariant failed", error);
    }
  }

  private void applyVariant(String variant, ReadableMap config) {
    if (config != null && "request".equals(variant)) {
      rememberRequestConfig(config);
    }
    if (!(overlayView instanceof FrameLayout)) return;

    currentVariant = variant;
    renderBubble((FrameLayout) overlayView, variant);
    applyLayoutForVariant(variant);
  }

  private void openApp() {
    openAppWithAction("open");
  }

  private void hideOverlay() {
    if (windowManager != null && overlayView != null) {
      try {
        windowManager.removeView(overlayView);
      } catch (Exception ignored) {
      }
    }
    overlayView = null;
    currentVariant = "";
    layoutParams = null;
  }

  private View createPulseRing(
    int sizeDp,
    String color,
    float maxScale,
    float startAlpha,
    float endAlpha,
    long duration,
    long startOffset
  ) {
    View ring = new View(reactContext);
    GradientDrawable background = new GradientDrawable();
    background.setShape(GradientDrawable.OVAL);
    background.setColor(Color.parseColor(color));
    ring.setBackground(background);

    FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(sizeDp), dp(sizeDp), Gravity.CENTER);
    ring.setLayoutParams(params);

    AnimationSet pulse = new AnimationSet(true);
    ScaleAnimation scale = new ScaleAnimation(
      1f,
      maxScale,
      1f,
      maxScale,
      Animation.RELATIVE_TO_SELF,
      0.5f,
      Animation.RELATIVE_TO_SELF,
      0.5f
    );
    AlphaAnimation fade = new AlphaAnimation(startAlpha, endAlpha);
    pulse.addAnimation(scale);
    pulse.addAnimation(fade);
    pulse.setDuration(duration);
    pulse.setRepeatCount(Animation.INFINITE);
    pulse.setRepeatMode(Animation.RESTART);
    pulse.setStartOffset(startOffset);
    ring.startAnimation(pulse);

    return ring;
  }

  private View createCenterCircle(String color, String strokeColor, int sizeDp) {
    View circle = new View(reactContext);
    GradientDrawable background = new GradientDrawable();
    background.setShape(GradientDrawable.OVAL);
    background.setColor(Color.parseColor(color));
    background.setStroke(dp(2), Color.parseColor(strokeColor));
    circle.setBackground(background);
    circle.setElevation(dp(10));
    circle.setLayoutParams(new FrameLayout.LayoutParams(dp(sizeDp), dp(sizeDp), Gravity.CENTER));
    return circle;
  }

  private View createBadge(String fillColor, String strokeColor, int sizeDp, int topDp, int endDp) {
    View badge = new View(reactContext);
    GradientDrawable background = new GradientDrawable();
    background.setShape(GradientDrawable.OVAL);
    background.setColor(Color.parseColor(fillColor));
    background.setStroke(dp(3), Color.parseColor(strokeColor));
    badge.setBackground(background);
    badge.setElevation(dp(12));

    FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(sizeDp), dp(sizeDp), Gravity.TOP | Gravity.END);
    params.setMargins(0, dp(topDp), dp(endDp), 0);
    badge.setLayoutParams(params);
    return badge;
  }

  private View createOverlayView() {
    FrameLayout container = new FrameLayout(reactContext);
    container.setClipChildren(false);
    container.setClipToPadding(false);
    container.setLayoutParams(new FrameLayout.LayoutParams(dp(116), dp(116)));
    container.setMinimumWidth(dp(116));
    container.setMinimumHeight(dp(116));
    container.setElevation(dp(8));
    container.setPadding(dp(12), dp(12), dp(12), dp(12));

    renderBubble(container, "online");

    container.setOnTouchListener((view, event) -> {
      if (layoutParams == null || windowManager == null) return false;
      if ("request".equals(currentVariant)) return false;

      switch (event.getAction()) {
        case MotionEvent.ACTION_DOWN:
          initialX = layoutParams.x;
          initialY = layoutParams.y;
          initialTouchX = event.getRawX();
          initialTouchY = event.getRawY();
          touchStartedAt = System.currentTimeMillis();
          return true;
        case MotionEvent.ACTION_MOVE:
          layoutParams.x = initialX + Math.round(event.getRawX() - initialTouchX);
          layoutParams.y = initialY + Math.round(event.getRawY() - initialTouchY);
          windowManager.updateViewLayout(overlayView, layoutParams);
          return true;
        case MotionEvent.ACTION_UP:
          float dx = Math.abs(event.getRawX() - initialTouchX);
          float dy = Math.abs(event.getRawY() - initialTouchY);
          long elapsed = System.currentTimeMillis() - touchStartedAt;
          long overlayAge = System.currentTimeMillis() - overlayCreatedAt;
          if (overlayAge > 1200 && dx < dp(10) && dy < dp(10) && elapsed < 350) {
            openApp();
          }
          return true;
        default:
          return false;
      }
    });

    return container;
  }

  @ReactMethod
  public void canDrawOverlays(Promise promise) {
    boolean canDraw = canDrawOverlaysInternal();
    Log.d(TAG, "canDrawOverlays=" + canDraw + " sdk=" + Build.VERSION.SDK_INT);
    promise.resolve(canDraw);
  }

  @Override
  public void onHostResume() {
    Log.d(TAG, "onHostResume (no-op - overlay managed by JS)");
  }

  @Override
  public void onHostPause() {
    Log.d(TAG, "onHostPause");
  }

  @Override
  public void onHostDestroy() {
    UiThreadUtil.runOnUiThread(() -> hideOverlay());
  }

  @ReactMethod
  public void openOverlaySettings(Promise promise) {
    try {
      Log.d(TAG, "openOverlaySettings");
      Intent intent = new Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + reactContext.getPackageName())
      );
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception error) {
      Log.e(TAG, "openOverlaySettings failed", error);
      promise.reject("overlay_settings_failed", error);
    }
  }

  @ReactMethod
  public void show(ReadableMap config, Promise promise) {
    final String variant = getVariant(config);
    Log.d(TAG, "show called variant=" + variant + " canDraw=" + canDrawOverlaysInternal());
    if (!canDrawOverlaysInternal()) {
      promise.reject("overlay_permission_missing", "Display over other apps permission is not enabled.");
      return;
    }

    UiThreadUtil.runOnUiThread(() -> {
      try {
        if (windowManager == null) {
          windowManager = (WindowManager) reactContext.getSystemService(Context.WINDOW_SERVICE);
        }

        if (overlayView == null) {
          overlayView = createOverlayView();
          overlayCreatedAt = System.currentTimeMillis();
          int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

          layoutParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
          );
          layoutParams.gravity = Gravity.TOP | Gravity.START;
          layoutParams.x = dp(16);
          layoutParams.y = dp(120);
          windowManager.addView(overlayView, layoutParams);
        }

        applyVariant(variant, config);
        promise.resolve(true);
      } catch (Exception error) {
        Log.e(TAG, "show failed", error);
        promise.reject("overlay_show_failed", error);
      }
    });
  }

  @ReactMethod
  public void update(ReadableMap config, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      try {
        if (overlayView == null) {
          promise.resolve(false);
          return;
        }
        applyVariant(getVariant(config), config);
        promise.resolve(true);
      } catch (Exception error) {
        Log.e(TAG, "update failed", error);
        promise.reject("overlay_update_failed", error);
      }
    });
  }

  @ReactMethod
  public void hide(Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      try {
        hideOverlay();
        promise.resolve(true);
      } catch (Exception error) {
        Log.e(TAG, "hide failed", error);
        promise.reject("overlay_hide_failed", error);
      }
    });
  }

  @ReactMethod
  public void showFullScreenRideRequest(ReadableMap config, Promise promise) {
    try {
      Intent intent = new Intent(reactContext, RideRequestFullScreenActivity.class);
      intent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK |
        Intent.FLAG_ACTIVITY_CLEAR_TOP |
        Intent.FLAG_ACTIVITY_SINGLE_TOP
      );
      intent.putExtra("title", getMapString(config, "title", "New ride request"));
      intent.putExtra("body", getMapString(config, "body", "A new ride request has arrived."));
      intent.putExtra("pickupLabel", getMapString(config, "pickupLabel", null));
      intent.putExtra("dropoffLabel", getMapString(config, "dropoffLabel", null));
      intent.putExtra("fareLabel", getMapString(config, "fareLabel", null));
      intent.putExtra("rideRequestId", getMapString(config, "rideRequestId", null));
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception error) {
      Log.e(TAG, "showFullScreenRideRequest failed", error);
      promise.reject("fullscreen_ride_request_failed", error);
    }
  }
}
`;
}

function overlayPackageSource(androidPackage) {
  return `package ${androidPackage}.overlay;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TrustOverlayPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new TrustOverlayModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;
}

function fullScreenActivitySource(androidPackage) {
  return `package ${androidPackage}.overlay;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class RideRequestFullScreenActivity extends Activity {
  private String rideRequestId = "";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    }
    getWindow().addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
      WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
      WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
      WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
    );

    String title = getIntent().getStringExtra("title");
    String body = getIntent().getStringExtra("body");
    String pickup = getIntent().getStringExtra("pickupLabel");
    if (pickup == null) pickup = getIntent().getStringExtra("pickup");
    String dropoff = getIntent().getStringExtra("dropoffLabel");
    if (dropoff == null) dropoff = getIntent().getStringExtra("dropoff");
    String fareLabel = getIntent().getStringExtra("fareLabel");
    rideRequestId = getIntent().getStringExtra("rideRequestId");
    if (rideRequestId == null) rideRequestId = "";

    if ((body == null || body.trim().isEmpty()) && (pickup != null || dropoff != null)) {
      body = (pickup != null ? pickup : "Pickup") + " to " + (dropoff != null ? dropoff : "Drop-off");
    }

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(48, 48, 48, 48);
    root.setBackgroundColor(Color.parseColor("#FF101820"));
    root.setGravity(Gravity.CENTER_VERTICAL);

    TextView brandView = new TextView(this);
    brandView.setText("Trust Express");
    brandView.setTextColor(Color.parseColor("#8EB6FF"));
    brandView.setTextSize(14);
    brandView.setPadding(0, 0, 0, 12);
    root.addView(brandView);

    TextView titleView = new TextView(this);
    titleView.setText(title != null ? title : "New ride request");
    titleView.setTextColor(Color.WHITE);
    titleView.setTextSize(26);
    titleView.setPadding(0, 0, 0, 24);
    root.addView(titleView);

    TextView bodyView = new TextView(this);
    bodyView.setText(body != null ? body : "A new ride request has arrived.");
    bodyView.setTextColor(Color.parseColor("#F0F0F0"));
    bodyView.setTextSize(16);
    bodyView.setPadding(0, 0, 0, 24);
    root.addView(bodyView);

    if (pickup != null || dropoff != null) {
      TextView routeView = new TextView(this);
      String routeText = "";
      if (pickup != null) routeText += "From: " + pickup + "\\n";
      if (dropoff != null) routeText += "To: " + dropoff;
      routeView.setText(routeText.trim());
      routeView.setTextColor(Color.parseColor("#CCCCCC"));
      routeView.setTextSize(14);
      routeView.setPadding(0, 0, 0, 16);
      root.addView(routeView);
    }

    if (fareLabel != null && fareLabel.trim().length() > 0) {
      TextView fareView = new TextView(this);
      fareView.setText(fareLabel);
      fareView.setTextColor(Color.WHITE);
      fareView.setTextSize(18);
      fareView.setPadding(0, 0, 0, 28);
      root.addView(fareView);
    }

    LinearLayout actions = new LinearLayout(this);
    actions.setOrientation(LinearLayout.HORIZONTAL);
    actions.setGravity(Gravity.CENTER);

    Button declineButton = createButton("Decline", "#374151");
    declineButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View view) {
        openApp("decline");
      }
    });
    LinearLayout.LayoutParams declineParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    declineParams.setMargins(0, 0, 16, 0);
    declineButton.setLayoutParams(declineParams);
    actions.addView(declineButton);

    Button acceptButton = createButton("Accept", "#206EFF");
    acceptButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View view) {
        openApp("accept");
      }
    });
    LinearLayout.LayoutParams acceptParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f);
    acceptParams.setMargins(16, 0, 0, 0);
    acceptButton.setLayoutParams(acceptParams);
    actions.addView(acceptButton);

    root.addView(actions);

    Button openButton = createButton("Open app", "#1F2937");
    LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    );
    openParams.setMargins(0, 28, 0, 0);
    openButton.setLayoutParams(openParams);
    openButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View view) {
        openApp("open");
      }
    });
    root.addView(openButton);

    setContentView(root);
  }

  private Button createButton(String label, String fillColor) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    button.setTextColor(Color.WHITE);
    GradientDrawable background = new GradientDrawable();
    background.setColor(Color.parseColor(fillColor));
    background.setCornerRadius(28);
    button.setBackground(background);
    return button;
  }

  private void openApp(String action) {
    Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launchIntent != null) {
      launchIntent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK |
        Intent.FLAG_ACTIVITY_SINGLE_TOP |
        Intent.FLAG_ACTIVITY_CLEAR_TOP
      );
      String deepLink = "trustexpress://driver/incoming-ride";
      String query = "";
      if (rideRequestId != null && rideRequestId.trim().length() > 0) {
        query += "rideRequestId=" + Uri.encode(rideRequestId.trim());
        launchIntent.putExtra("rideRequestId", rideRequestId.trim());
      }
      if (action != null && action.trim().length() > 0) {
        if (query.length() > 0) query += "&";
        query += "action=" + Uri.encode(action.trim());
      }
      if (query.length() > 0) deepLink = deepLink + "?" + query;
      launchIntent.setData(Uri.parse(deepLink));
      launchIntent.putExtra("openIncomingRideOverlay", true);
      launchIntent.putExtra("overlayAction", action);
      startActivity(launchIntent);
    }
    finish();
  }
}
`;
}

function withTrustOverlay(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.SYSTEM_ALERT_WINDOW',
  ]);

  config = withDangerousMod(config, ['android', async (config) => {
    const androidPackage = getAndroidPackage(config);
    const packagePath = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'java',
      ...androidPackage.split('.'),
      'overlay'
    );

    fs.mkdirSync(packagePath, { recursive: true });
    fs.writeFileSync(path.join(packagePath, 'TrustOverlayModule.java'), overlayModuleSource(androidPackage));
    fs.writeFileSync(path.join(packagePath, 'TrustOverlayPackage.java'), overlayPackageSource(androidPackage));
    fs.writeFileSync(path.join(packagePath, 'RideRequestFullScreenActivity.java'), fullScreenActivitySource(androidPackage));

    const manifestPath = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'AndroidManifest.xml'
    );

    let manifestContents = fs.readFileSync(manifestPath, 'utf8');
    const activityName = `${androidPackage}.overlay.RideRequestFullScreenActivity`;

    if (!manifestContents.includes(activityName)) {
      const activityXml = `
        <activity
          android:name="${activityName}"
          android:exported="true"
          android:showWhenLocked="true"
          android:turnScreenOn="true"
          android:showForAllUsers="true"
          android:screenOrientation="portrait"
          android:taskAffinity="${androidPackage}.RideRequestFullScreen"
          android:launchMode="singleTask">
          <intent-filter>
            <action android:name="com.tatenda10.trustexpress.FULL_SCREEN_RIDE_REQUEST" />
            <category android:name="android.intent.category.DEFAULT" />
          </intent-filter>
        </activity>
      `;
      manifestContents = manifestContents.replace(/<\/application>/, `${activityXml}\n    </application>`);
      fs.writeFileSync(manifestPath, manifestContents, 'utf8');
    }

    return config;
  }]);

  config = withMainApplication(config, (config) => {
    const androidPackage = getAndroidPackage(config);
    const language = config.modResults.language;
    config.modResults.contents = patchMainApplication(
      config.modResults.contents,
      androidPackage,
      language
    );
    return config;
  });

  return config;
}

module.exports = withTrustOverlay;
module.exports.patchMainApplication = patchMainApplication;
module.exports.overlayModuleSource = overlayModuleSource;
module.exports.fullScreenActivitySource = fullScreenActivitySource;
