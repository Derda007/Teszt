package hu.ocr.szovegkinyero;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Az OCR Szövegkinyerő Android-változata.
 * <p>
 * Ugyanaz a webalkalmazás fut, mint a böngészőben – csak az APK-ból kiszolgálva,
 * kamerás fényképezéssel és natív fájlmentéssel kiegészítve.
 */
public class MainActivity extends Activity {

    private static final int FAJLVALASZTAS = 1001;

    private WebView webView;
    private EszkozKiszolgalo kiszolgalo;

    /** A folyamatban lévő fájlválasztás visszahívása. */
    private ValueCallback<Uri[]> fajlValaszthivas;

    /** A kamera ide írja a képet, ha a felhasználó fényképezést választ. */
    private Uri kameraCim;

    @Override
    protected void onCreate(Bundle mentettAllapot) {
        super.onCreate(mentettAllapot);

        kiszolgalo = new EszkozKiszolgalo(getAssets());

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        beallitasok();
        webView.setWebViewClient(new SajatWebViewClient());
        webView.setWebChromeClient(new SajatWebChromeClient());
        webView.addJavascriptInterface(new MentesHid(this), MentesHid.NEV);

        /* Folyamat-újraindítás után az előzményekből állunk vissza; ha nincs
           mit visszaállítani, egyszerűen betöltjük az oldalt. */
        if (mentettAllapot == null || webView.restoreState(mentettAllapot) == null) {
            webView.loadUrl(EszkozKiszolgalo.EREDET + "/index.html");
        }
    }

    private void beallitasok() {
        WebSettings b = webView.getSettings();
        b.setJavaScriptEnabled(true);
        b.setDomStorageEnabled(true);          // a nyelvi adatok gyorsítótárához
        b.setDatabaseEnabled(true);
        b.setLoadWithOverviewMode(true);
        b.setUseWideViewPort(true);
        b.setSupportZoom(true);
        b.setBuiltInZoomControls(true);
        b.setDisplayZoomControls(false);

        /* Semmit nem töltünk a fájlrendszerről vagy a hálózatról: minden az
           APK-ból, a saját https eredetünkön keresztül érkezik. */
        b.setAllowFileAccess(false);
        b.setAllowContentAccess(false);
        b.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    /* ------------------------------------------------------------------ *
     * WebView-kiszolgálás
     * ------------------------------------------------------------------ */

    private final class SajatWebViewClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView nezet, WebResourceRequest keres) {
            return kiszolgalo.valasz(keres);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView nezet, WebResourceRequest keres) {
            Uri cim = keres.getUrl();
            if (cim != null && cim.toString().startsWith(EszkozKiszolgalo.EREDET)) {
                return false;
            }
            /* Külső hivatkozás a rendszer böngészőjébe megy, nem ide. */
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, cim));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, R.string.nincs_bongeszo, Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView nezet, String cim) {
            temaAtadasa();
        }
    }

    /** A rendszer sötét/világos beállítását átadjuk az oldalnak. */
    private void temaAtadasa() {
        int mod = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String tema = mod == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        webView.evaluateJavascript(
                "document.documentElement.setAttribute('data-theme','" + tema + "')", null);
    }

    @Override
    public void onConfigurationChanged(Configuration ujBeallitas) {
        super.onConfigurationChanged(ujBeallitas);
        temaAtadasa();
    }

    /* ------------------------------------------------------------------ *
     * Fájlválasztás: galéria, fájlok és fényképezés
     * ------------------------------------------------------------------ */

    private final class SajatWebChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView nezet,
                                         ValueCallback<Uri[]> visszahivas,
                                         FileChooserParams parameterek) {
            /* Egyszerre csak egy választás lehet folyamatban. */
            if (fajlValaszthivas != null) {
                fajlValaszthivas.onReceiveValue(null);
            }
            fajlValaszthivas = visszahivas;
            kameraCim = null;

            Intent tallozas = parameterek.createIntent();
            tallozas.addCategory(Intent.CATEGORY_OPENABLE);

            Intent valaszto = Intent.createChooser(tallozas, getString(R.string.fajl_valasztas));

            Intent fenykepezes = fenykepezesSzandeka(parameterek);
            if (fenykepezes != null) {
                valaszto.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{fenykepezes});
            }

            try {
                startActivityForResult(valaszto, FAJLVALASZTAS);
                return true;
            } catch (ActivityNotFoundException e) {
                fajlValaszthivas = null;
                Toast.makeText(MainActivity.this, R.string.nincs_fajlkezelo, Toast.LENGTH_LONG).show();
                visszahivas.onReceiveValue(null);
                return false;
            }
        }
    }

    /**
     * Fényképezési szándék, ha a mező képet is elfogad és van kameraalkalmazás.
     * A kép az alkalmazás saját könyvtárába kerül, így nem kell hozzá
     * tárhely- vagy kameraengedély.
     */
    private Intent fenykepezesSzandeka(WebChromeClient.FileChooserParams parameterek) {
        if (!kepetIsElfogad(parameterek)) {
            return null;
        }

        Intent szandek = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (szandek.resolveActivity(getPackageManager()) == null) {
            return null;
        }

        try {
            File mappa = new File(getFilesDir(), "fotok");
            if (!mappa.exists() && !mappa.mkdirs()) {
                return null;
            }

            String idopont = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
            File kep = new File(mappa, "foto-" + idopont + ".jpg");
            if (!kep.createNewFile() && !kep.exists()) {
                return null;
            }

            kameraCim = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", kep);

            szandek.putExtra(MediaStore.EXTRA_OUTPUT, kameraCim);
            szandek.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            /* Régebbi rendszereken a kameraalkalmazás nem mindig kapja meg
               automatikusan az írási jogot a cím alapján. */
            List<android.content.pm.ResolveInfo> talalatok = getPackageManager()
                    .queryIntentActivities(szandek, PackageManager.MATCH_DEFAULT_ONLY);
            for (android.content.pm.ResolveInfo talalat : talalatok) {
                grantUriPermission(talalat.activityInfo.packageName, kameraCim,
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            return szandek;
        } catch (IOException e) {
            kameraCim = null;
            return null;
        }
    }

    private static boolean kepetIsElfogad(WebChromeClient.FileChooserParams parameterek) {
        String[] tipusok = parameterek.getAcceptTypes();
        if (tipusok == null || tipusok.length == 0) {
            return true;
        }
        for (String tipus : tipusok) {
            if (tipus == null) {
                continue;
            }
            String kicsi = tipus.toLowerCase(Locale.ROOT);
            if (kicsi.isEmpty() || kicsi.startsWith("image/") || kicsi.equals("*/*")) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected void onActivityResult(int keresKod, int eredmeny, Intent adat) {
        if (keresKod != FAJLVALASZTAS) {
            super.onActivityResult(keresKod, eredmeny, adat);
            return;
        }

        if (fajlValaszthivas == null) {
            return;
        }

        Uri[] cimek = null;

        if (eredmeny == RESULT_OK) {
            if (adat == null || (adat.getData() == null && adat.getClipData() == null)) {
                /* A kameraalkalmazás nem ad vissza adatot: a képet abba a
                   fájlba írta, amit mi adtunk meg neki. */
                if (kameraCim != null) {
                    cimek = new Uri[]{kameraCim};
                }
            } else if (adat.getClipData() != null) {
                ClipData kivalasztott = adat.getClipData();
                List<Uri> lista = new ArrayList<>();
                for (int i = 0; i < kivalasztott.getItemCount(); i++) {
                    Uri cim = kivalasztott.getItemAt(i).getUri();
                    if (cim != null) {
                        lista.add(cim);
                    }
                }
                if (!lista.isEmpty()) {
                    cimek = lista.toArray(new Uri[0]);
                }
            } else {
                cimek = new Uri[]{adat.getData()};
            }
        }

        /* A visszahívást minden ágon meg KELL hívni – különben a fájlmező
           örökre használhatatlan marad. */
        fajlValaszthivas.onReceiveValue(cimek);
        fajlValaszthivas = null;
        kameraCim = null;
    }

    /* ------------------------------------------------------------------ *
     * Életciklus
     * ------------------------------------------------------------------ */

    @Override
    protected void onSaveInstanceState(Bundle allapot) {
        super.onSaveInstanceState(allapot);
        if (webView != null) {
            webView.saveState(allapot);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
