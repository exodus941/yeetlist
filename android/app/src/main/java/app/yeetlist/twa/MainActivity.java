package app.yeetlist.twa;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/* THE WHOLE APP IS ONE WINDOW HOLDING THE LIVE SITE.
 *
 * Their decision, 24 September 2026: route A. The page is the same page the
 * website serves, so every screen, every fix and every future change arrive
 * with a deploy and never need a new APK. What this class adds is only what a
 * browser used to do for free:
 *
 *   Google sign-in    through Android's own account picker
 *   shares            a link shared from any app lands in the list
 *   file import       the page's file picker opens Android's
 *   export            a save dialog, because a web view cannot download
 *   links elsewhere   open in whatever app handles them
 *   back              walks back through the page, then leaves
 *
 * NOTHING HERE HOLDS DATA. The list, the notes and the Google link cookie
 * live in the web view's own storage, which belongs to this app alone.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 41;
    private static final int SAVE_FILE = 42;
    private static final int LINK_DRIVE = 43;

    /* The narrowest Drive scope, and the same one the website asks for. */
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

    private WebView web;
    private String siteUrl;
    private String siteHost;

    /* THE BRIDGE ANSWERS ONLY THE SITE. It is set as each page starts, so a
       page from anywhere else, which should never load here anyway, cannot
       reach it. Read from the bridge's own thread, hence volatile. */
    private volatile boolean onSite = false;

    private ValueCallback<Uri[]> pickCallback;
    private String saveText;
    private String saveName;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        siteUrl = getString(R.string.siteUrl);
        siteHost = getString(R.string.siteHost);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.page));
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.page));
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        keepClearOfSystemBars(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        /* THE PAGE CAN TELL IT IS INSIDE THE APP, and which build. */
        s.setUserAgentString(s.getUserAgentString() + " YeeTlistApp/" + BuildConfig.VERSION_NAME);

        /* THE GOOGLE LINK IS A COOKIE, so cookies are kept. It never leaves
           this app's storage, which is the whole point of the move. */
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "YeetlistAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        /* A plain download, such as an installer, goes to whatever handles it.
           The page's own files go through saveFile() instead, because a web
           view cannot save a file the page made itself. */
        web.setDownloadListener((url, agent, disposition, mime, length) -> openOutside(Uri.parse(url)));

        watchBack();
        web.loadUrl(startUrl(getIntent()));
    }

    /* A SHARE WHILE THE APP IS OPEN ARRIVES HERE. singleTask keeps one window,
       so Android hands the new share to it rather than dropping it, which is
       what the old wrapper did. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String share = shareUrl(intent);
        if (share != null) web.loadUrl(share);
    }

    private String startUrl(Intent intent) {
        String share = shareUrl(intent);
        return share != null ? share : siteUrl;
    }

    /* THE SAME ADDRESS THE WEBSITE'S OWN SHARE TARGET USES, so the page reads
       a share exactly the way it always has. Android puts the link in the
       text, and a title when the sending app has one. */
    private String shareUrl(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return null;
        Uri.Builder b = Uri.parse(siteUrl).buildUpon().appendQueryParameter("text", text);
        String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (title != null && !title.trim().isEmpty()) b.appendQueryParameter("title", title);
        return b.build().toString();
    }

    private boolean isSite(Uri u) {
        return u != null && "https".equals(u.getScheme()) && siteHost.equals(u.getHost());
    }

    private void openOutside(Uri u) {
        Intent view = new Intent(Intent.ACTION_VIEW, u);
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(view);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone opens that link.", Toast.LENGTH_LONG).show();
        }
    }

    /* THE PAGE DRAWS TO THE EDGES ON NEW ANDROID, so it is kept clear of the
       status bar, the gesture bar and the keyboard. From Android 15 an app
       built for it is drawn under all three whatever it asks, and the
       keyboard no longer pushes the page up on its own. */
    private void keepClearOfSystemBars(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });
    }

    /* BACK WALKS BACK THROUGH THE PAGE, THEN LEAVES WITHOUT CLOSING. Leaving
       keeps the page as it was, so coming back is instant.

       From Android 16 the old back method is no longer called for an app
       built for it, so the new callback is the one that works there. */
    private void watchBack() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    private void goBack() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onPause() {
        super.onPause();
        /* Written to disk now, or a phone that kills the app in the
           background could lose a link made seconds before. */
        CookieManager.getInstance().flush();
    }

    /* -- The page's file picker, the save dialog, and the Google sign-in -- */

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);

        if (request == PICK_FILE) {
            if (pickCallback != null) {
                pickCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                pickCallback = null;
            }
            return;
        }

        if (request == SAVE_FILE) {
            String name = saveName;
            String text = saveText;
            saveName = null;
            saveText = null;
            if (result != RESULT_OK || data == null || data.getData() == null || text == null) {
                page("saved", false, "");
                return;
            }
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                if (out == null) throw new Exception("the phone gave no place to write");
                out.write(text.getBytes(StandardCharsets.UTF_8));
                page("saved", true, name == null ? "" : name);
            } catch (Exception e) {
                page("saved", false, String.valueOf(e.getMessage()));
            }
            return;
        }

        if (request == LINK_DRIVE) {
            try {
                AuthorizationResult granted = Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(data);
                deliverCode(granted.getServerAuthCode());
            } catch (ApiException e) {
                page("linkFailed", reasonOf(e));
            }
        }
    }

    /* ANDROID'S OWN ACCOUNT PICKER, THEN A ONE-TIME CODE FOR THE SERVER.
     *
     * Google will not show its sign-in page inside a web view, so the page
     * asks here instead. The code this returns is the same kind the website's
     * sign-in returns. The page hands it to the server, which turns it into a
     * lasting link and keeps that in a cookie inside this app.
     *
     * "OFFLINE ACCESS" IS WHAT MAKES THE LINK LAST. Without it Google hands
     * back an hour's access and nothing to renew it with. Asking with the
     * refresh flag set shows the consent screen each time, which is the only
     * way Google promises a lasting link on a second link.
     */
    private void linkDrive(String clientId) {
        if (clientId == null || clientId.trim().isEmpty()) {
            page("linkFailed", "unconfigured");
            return;
        }
        AuthorizationRequest ask = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_SCOPE)))
            .requestOfflineAccess(clientId.trim(), true)
            .build();
        Identity.getAuthorizationClient(this).authorize(ask)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    PendingIntent consent = result.getPendingIntent();
                    try {
                        startIntentSenderForResult(consent.getIntentSender(), LINK_DRIVE, null, 0, 0, 0);
                    } catch (Exception e) {
                        page("linkFailed", "google: " + e.getMessage());
                    }
                } else {
                    deliverCode(result.getServerAuthCode());
                }
            })
            .addOnFailureListener(e -> page("linkFailed", reasonOf(e)));
    }

    private void deliverCode(String code) {
        if (code == null || code.isEmpty()) page("linkFailed", "no_code");
        else page("linked", code);
    }

    /* PLAIN CODES THE PAGE TURNS INTO WORDS. The status numbers are Google's
       own: 10 means Google does not recognise this app, which is the one a
       missing Google Cloud entry produces. */
    private static String reasonOf(Exception e) {
        if (e instanceof ApiException) {
            int code = ((ApiException) e).getStatusCode();
            if (code == 10) return "developer_error";
            if (code == 16 || code == 12501) return "cancelled";
            if (code == 7) return "network";
            return "google_" + code;
        }
        return "google: " + e.getMessage();
    }

    /* ONE WAY BACK INTO THE PAGE. Every argument is quoted as a JSON string,
       so nothing Google or Android returns can break out of the call. */
    private void page(String method, Object... args) {
        StringBuilder call = new StringBuilder("window.yeetNative && window.yeetNative.")
            .append(method).append('(');
        for (int i = 0; i < args.length; i++) {
            if (i > 0) call.append(',');
            Object a = args[i];
            call.append(a instanceof Boolean ? a.toString() : JSONObject.quote(String.valueOf(a)));
        }
        call.append(')');
        runOnUiThread(() -> web.evaluateJavascript(call.toString(), null));
    }

    /* -- The page's side of the bridge -------------------------------------- */

    /* EVERY METHOD CHECKS IT IS THE SITE ASKING. They run on a thread of the
       web view's own, so anything touching the screen hops to the main one. */
    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void linkDrive(final String clientId) {
            if (!onSite) return;
            runOnUiThread(() -> MainActivity.this.linkDrive(clientId));
        }

        @JavascriptInterface
        public void checkForUpdate() {
            if (!onSite) return;
            new Thread(() -> UpdateCheck.runNow(getApplication()), "yeetlist-update-now").start();
        }

        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String text) {
            if (!onSite) return;
            runOnUiThread(() -> {
                saveName = name;
                saveText = text;
                Intent ask = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                ask.addCategory(Intent.CATEGORY_OPENABLE);
                String type = mime == null ? "text/plain" : mime.split(";")[0].trim();
                ask.setType(type.isEmpty() ? "text/plain" : type);
                ask.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(ask, SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    saveName = null;
                    saveText = null;
                    page("saved", false, "this phone has no place to save files");
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            if (!onSite || url == null) return;
            runOnUiThread(() -> openOutside(Uri.parse(url)));
        }
    }

    private final class Client extends WebViewClient {
        /* THE WINDOW ONLY EVER HOLDS THE SITE. A video, a bookmark or a mail
           link goes to the app that handles it. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isSite(u)) return false;
            openOutside(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            onSite = isSite(Uri.parse(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }
    }

    private final class Chrome extends WebChromeClient {
        /* THE PAGE'S IMPORT BUTTON OPENS ANDROID'S FILE PICKER. A web view
           shows nothing for a file field unless the app answers this. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (pickCallback != null) pickCallback.onReceiveValue(null);
            pickCallback = callback;
            try {
                startActivityForResult(params.createIntent(), PICK_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                pickCallback = null;
                return false;
            }
        }
    }
}
