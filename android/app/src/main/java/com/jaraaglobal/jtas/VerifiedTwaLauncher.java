package com.jaraaglobal.jtas;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import com.google.androidbrowserhelper.trusted.splashscreens.SplashScreenStrategy;

/** Keep the branded splash up while the launch session verifies its origin. */
public final class VerifiedTwaLauncher extends TwaLauncher {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pending;

    public VerifiedTwaLauncher(Context context) { super(context); }

    private void release() {
        if (pending == null) return;
        Runnable next = pending;
        pending = null;
        handler.removeCallbacksAndMessages(null);
        next.run();
    }

    @Override public void launch(TrustedWebActivityIntentBuilder builder,
            CustomTabsCallback callback, SplashScreenStrategy splash,
            Runnable completed, FallbackStrategy fallback) {
        if (splash == null) {
            super.launch(builder, callback, null, completed, fallback);
            return;
        }
        Uri origin = new Uri.Builder().scheme("https")
                .authority(builder.getUri().getAuthority()).build();
        CustomTabsCallback verifiedCallback = new CustomTabsCallback() {
            @Override public void onNavigationEvent(int event, Bundle extras) {
                if (callback != null) callback.onNavigationEvent(event, extras);
            }
            @Override public void extraCallback(String name, Bundle args) {
                if (callback != null) callback.extraCallback(name, args);
            }
            @Override public void onRelationshipValidationResult(int relation,
                    Uri requestedOrigin, boolean result, Bundle extras) {
                if (callback != null) callback.onRelationshipValidationResult(
                        relation, requestedOrigin, result, extras);
                if (relation == CustomTabsService.RELATION_HANDLE_ALL_URLS
                        && origin.equals(requestedOrigin)) handler.post(() -> release());
            }
        };
        SplashScreenStrategy verifiedSplash = new SplashScreenStrategy() {
            @Override public void onTwaLaunchInitiated(String provider,
                    TrustedWebActivityIntentBuilder intent) {
                splash.onTwaLaunchInitiated(provider, intent);
            }
            @Override public void configureTwaBuilder(TrustedWebActivityIntentBuilder intent,
                    CustomTabsSession session, Runnable ready) {
                pending = () -> splash.configureTwaBuilder(intent, session, ready);
                // Never strand the user on the splash if a browser lacks this callback.
                handler.postDelayed(() -> release(), 5000);
                if (!session.validateRelationship(CustomTabsService.RELATION_HANDLE_ALL_URLS,
                        origin, null)) release();
            }
        };
        super.launch(builder, verifiedCallback, verifiedSplash, completed, fallback);
    }

    @Override public void destroy() {
        pending = null;
        handler.removeCallbacksAndMessages(null);
        super.destroy();
    }
}
