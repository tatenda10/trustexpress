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
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.AnimationSet;
import android.view.animation.ScaleAnimation;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.UiThreadUtil;

public class TrustOverlayModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;
  private WindowManager windowManager;
  private View overlayView;
  private WindowManager.LayoutParams layoutParams;
  private String currentVariant = "";

  private int initialX;
  private int initialY;
  private float initialTouchX;
  private float initialTouchY;
  private long touchStartedAt;

  public TrustOverlayModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
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
    return "online";
  }

  private void renderVariant(FrameLayout container, String variant) {
    if (variant.equals(currentVariant) && container.getChildCount() > 0) return;

    currentVariant = variant;
    container.removeAllViews();

    if (variant.equals("request")) {
      container.addView(createPulseRing(88, "#5522C55E", 1.55f, 0.46f, 0.06f, 820, 0));
      container.addView(createPulseRing(70, "#7722C55E", 1.32f, 0.36f, 0.08f, 820, 180));
      container.addView(createCenterCircle("#16A34A", "#DCFCE7", 64));
      container.addView(createBadge());
      return;
    }

    container.addView(createPulseRing(86, "#33206EFF", 1.28f, 0.32f, 0.04f, 1600, 0));
    container.addView(createPulseRing(70, "#55206EFF", 1.18f, 0.26f, 0.06f, 1600, 420));
    container.addView(createCenterCircle("#206EFF", "#E8F0FF", 58));
  }

  private void updateOverlay(ReadableMap config) {
    if (!(overlayView instanceof FrameLayout)) return;

    renderVariant((FrameLayout) overlayView, getVariant(config));
  }

  private void openApp() {
    Intent launchIntent = reactContext.getPackageManager().getLaunchIntentForPackage(reactContext.getPackageName());
    if (launchIntent == null) return;
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    reactContext.startActivity(launchIntent);
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

  private View createBadge() {
    View badge = new View(reactContext);
    GradientDrawable background = new GradientDrawable();
    background.setShape(GradientDrawable.OVAL);
    background.setColor(Color.parseColor("#EF4444"));
    background.setStroke(dp(3), Color.WHITE);
    badge.setBackground(background);
    badge.setElevation(dp(12));

    FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.TOP | Gravity.END);
    params.setMargins(0, dp(16), dp(16), 0);
    badge.setLayoutParams(params);
    return badge;
  }

  private View createOverlayView() {
    FrameLayout container = new FrameLayout(reactContext);
    container.setClipChildren(false);
    container.setClipToPadding(false);
    container.setPadding(dp(4), dp(4), dp(4), dp(4));
    container.setLayoutParams(new FrameLayout.LayoutParams(dp(116), dp(116)));
    container.setMinimumWidth(dp(116));
    container.setMinimumHeight(dp(116));
    container.setElevation(dp(8));

    renderVariant(container, "online");

    container.setOnTouchListener((view, event) -> {
      if (layoutParams == null || windowManager == null) return false;

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
          if (dx < dp(10) && dy < dp(10) && elapsed < 350) {
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
    promise.resolve(canDrawOverlaysInternal());
  }

  @ReactMethod
  public void openOverlaySettings(Promise promise) {
    try {
      Intent intent = new Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + reactContext.getPackageName())
      );
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("overlay_settings_failed", error);
    }
  }

  @ReactMethod
  public void show(ReadableMap config, Promise promise) {
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

        updateOverlay(config);
        promise.resolve(true);
      } catch (Exception error) {
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
        updateOverlay(config);
        promise.resolve(true);
      } catch (Exception error) {
        promise.reject("overlay_update_failed", error);
      }
    });
  }

  @ReactMethod
  public void hide(Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      try {
        if (windowManager != null && overlayView != null) {
          windowManager.removeView(overlayView);
        }
        overlayView = null;
        currentVariant = "";
        layoutParams = null;
        promise.resolve(true);
      } catch (Exception error) {
        promise.reject("overlay_hide_failed", error);
      }
    });
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
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class RideRequestFullScreenActivity extends Activity {
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
    String dropoff = getIntent().getStringExtra("dropoffLabel");

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(48, 48, 48, 48);
    root.setBackgroundColor(Color.parseColor("#FF101820"));
    root.setGravity(Gravity.CENTER_VERTICAL);

    TextView titleView = new TextView(this);
    titleView.setText(title != null ? title : "New ride request");
    titleView.setTextColor(Color.WHITE);
    titleView.setTextSize(22);
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
      routeView.setPadding(0, 0, 0, 32);
      root.addView(routeView);
    }

    Button openButton = new Button(this);
    openButton.setText("Open app");
    openButton.setAllCaps(false);
    openButton.setBackgroundColor(Color.parseColor("#206EFF"));
    openButton.setTextColor(Color.WHITE);
    openButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View view) {
        openApp();
      }
    });

    root.addView(openButton);
    setContentView(root);
  }

  private void openApp() {
    Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launchIntent != null) {
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
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
