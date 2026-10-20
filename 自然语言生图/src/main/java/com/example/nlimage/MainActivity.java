package com.example.nlimage;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 外壳：一个全屏 WebView，加载 assets/www/首页.html（自然语言生图的网页界面）。
 * 网页通过 window.AndroidBridge 调原生能力：网络转发、保存文件、剪贴板。
 */
public class MainActivity extends Activity {
    private static final String TAG = "NlImage";
    private static final String HOME = "https://appassets.androidplatform.net/assets/www/" + Uri.encode("首页.html");
    private static final int REQ_FILE = 1001;
    private static final int REQ_TREE = 1002;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private NativeHttp http;
    private FileSaver saver;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                // 外部链接交给系统浏览器
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                if (multiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    Intent g = new Intent(Intent.ACTION_GET_CONTENT);
                    g.addCategory(Intent.CATEGORY_OPENABLE);
                    g.setType("*/*");
                    if (multiple) g.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    try {
                        startActivityForResult(Intent.createChooser(g, "选择文件"), REQ_FILE);
                    } catch (Exception e2) {
                        fileCallback = null;
                        callback.onReceiveValue(null);
                        Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_LONG).show();
                        return false;
                    }
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.messageLevel() + " " + m.sourceId() + ":" + m.lineNumber() + " " + m.message());
                return true;
            }
        });

        http = new NativeHttp(web);
        saver = new FileSaver(this);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.loadUrl(HOME);

        requestRuntimePermissions();
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        } else if (Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 2);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_TREE) {
            String uri = null, name = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri tree = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(tree,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    uri = tree.toString();
                    name = saver.treeName(tree);
                } catch (Exception e) {
                    Toast.makeText(this, "这个文件夹没法授权写入，换一个试试", Toast.LENGTH_LONG).show();
                }
            }
            web.evaluateJavascript("window.__onSaveFolder && window.__onSaveFolder("
                    + (uri == null ? "null" : JSONObject.quote(uri)) + "," + (name == null ? "null" : JSONObject.quote(name)) + ")", null);
            return;
        }
        if (requestCode != REQ_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__appBack && window.__appBack()) ? 'y' : 'n'", v -> {
            if (v == null || !v.contains("y")) {
                // 不退出，只退到后台，后台任务继续跑
                moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onDestroy() {
        http.shutdown();
        KeepAliveService.stop(this);
        web.destroy();
        super.onDestroy();
    }

    /** 暴露给网页的原生方法（在 JavaBridge 线程上调用） */
    private class Bridge {
        @JavascriptInterface
        public void httpStart(String id, String method, String url, String headersJson, String bodyB64) {
            http.start(id, method, url, headersJson, bodyB64);
        }

        @JavascriptInterface
        public void httpAbort(String id) {
            http.abort(id);
        }

        @JavascriptInterface
        public String fileBegin(String name, String mime) {
            return saver.begin(name, mime);
        }

        @JavascriptInterface
        public String fileChunk(String token, String b64) {
            return saver.chunk(token, b64);
        }

        @JavascriptInterface
        public String fileEnd(String token) {
            return saver.end(token);
        }

        /** 图片保存位置：hidden / album / custom（tree = 文件夹授权 Uri，hide = 放 .nomedia） */
        @JavascriptInterface
        public void setSaveTarget(String mode, String tree, boolean hide) {
            saver.setTarget(mode, tree, hide);
        }

        /** 打开系统文件夹选择器，选完回调 window.__onSaveFolder(uri, 名字)，取消回调 (null, null) */
        @JavascriptInterface
        public void pickSaveFolder() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {
                    startActivityForResult(i, REQ_TREE);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "这台手机没有文件夹选择器", Toast.LENGTH_LONG).show();
                    web.evaluateJavascript("window.__onSaveFolder && window.__onSaveFolder(null,null)", null);
                }
            });
        }

        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("text", text));
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            final String[] out = {""};
            final CountDownLatch latch = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                        CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                        if (t != null) out[0] = t.toString();
                    }
                } catch (Exception ignored) {
                }
                latch.countDown();
            });
            try {
                latch.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            return out[0];
        }

        /** 写提示词、出图期间开前台服务，切到后台也不断；全部完成后关掉 */
        @JavascriptInterface
        public void keepAlive(boolean on) {
            if (on) KeepAliveService.start(MainActivity.this);
            else KeepAliveService.stop(MainActivity.this);
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }
    }
}
