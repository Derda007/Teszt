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
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Az OCR Szövegkinyerő Android-változata.
 * <p>
 * Ugyanaz a webalkalmazás fut, mint a böngészőben – csak az APK-ból kiszolgálva,
 * kamerás fényképezéssel és natív fájlmentéssel kiegészítve.
 */
public class MainActivity extends Activity {

    private static final int FAJLVALASZTAS = 1001;

    private static final String NAPLO = "OcrMain";

    /** A mentett állapotban a kamerakép fájljának útvonala. */
    private static final String ALLAPOT_KAMERAFAJL = "kamerafajl";

    private WebView webView;
    private EszkozKiszolgalo kiszolgalo;
    private Atvetel atvetel;

    /** A képek kicsinyítése nem futhat a főszálon. */
    private final ExecutorService hatter = Executors.newSingleThreadExecutor();

    /** A folyamatban lévő fájlválasztás visszahívása. */
    private ValueCallback<Uri[]> fajlValaszthivas;

    /** Az a nézet, amelyik a fájlválasztást kérte. Ha közben lecseréltük,
     *  a visszahívása már senkihez nem jut el. */
    private WebView valasztoNezet;

    /** A kamera ide írja a képet, ha a felhasználó fényképezést választ. */
    private File kameraFajl;
    private Uri kameraCim;

    @Override
    protected void onCreate(Bundle mentettAllapot) {
        super.onCreate(mentettAllapot);

        atvetel = new Atvetel(this);
        kiszolgalo = new EszkozKiszolgalo(getAssets(), atvetel);

        if (mentettAllapot == null) {
            /* Friss indítás: a korábbi futások ideiglenes fájljai törölhetők. */
            atvetel.takaritas();
            regiFotokTorlese();
        } else {
            /* A rendszer a kamera használata közben leállíthatta az
               alkalmazást; a kép helyét meg kell őriznünk, hogy az
               onActivityResult még átvehesse. */
            String ut = mentettAllapot.getString(ALLAPOT_KAMERAFAJL);
            if (ut != null) {
                kameraFajl = new File(ut);
            }
        }

        webViewLetrehozasa();

        /* Folyamat-újraindítás után az előzményekből állunk vissza; ha nincs
           mit visszaállítani, egyszerűen betöltjük az oldalt. */
        if (mentettAllapot == null || webView.restoreState(mentettAllapot) == null) {
            webView.loadUrl(EszkozKiszolgalo.EREDET + "/index.html");
        }
    }

    private void webViewLetrehozasa() {
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        beallitasok();
        webView.setWebViewClient(new SajatWebViewClient());
        webView.setWebChromeClient(new SajatWebChromeClient());
        webView.addJavascriptInterface(new MentesHid(this), MentesHid.NEV);
        webView.addJavascriptInterface(atvetel, Atvetel.NEV);
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

        /**
         * A megjelenítő folyamat leállt – többnyire azért, mert a rendszer
         * memóriát szabadított fel (pl. amíg a kamera volt előtérben), vagy
         * mert egy túl nagy kép kifogyasztotta a memóriát. Ha ezt nem kezeljük
         * ({@code false}), Android 8-tól az egész alkalmazás leáll: ez volt a
         * fényképezés és a beillesztés utáni "kilépés" oka. Helyette új
         * nézetet hozunk létre, és újratöltjük az oldalt.
         */
        @Override
        public boolean onRenderProcessGone(WebView nezet, RenderProcessGoneDetail reszletek) {
            Log.w(NAPLO, "A megjelenítő leállt (összeomlás: " + reszletek.didCrash() + ")");

            if (nezet == webView) {
                webViewLetrehozasa();     // az új nézet le is cseréli a régit
                webView.loadUrl(EszkozKiszolgalo.EREDET + "/index.html");
                Toast.makeText(MainActivity.this, R.string.megjelenito_ujraindult,
                        Toast.LENGTH_LONG).show();
            }
            nezet.destroy();
            return true;
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
            valasztoNezet = nezet;
            kameraFajl = null;
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
                valasztoNezet = null;
                kameraTorlese();
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

            kameraFajl = kep;
            kameraCim = fajlCim(kep);

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
        } catch (IOException | IllegalArgumentException e) {
            kameraTorlese();
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

        final ValueCallback<Uri[]> visszahivas = fajlValaszthivas;
        final WebView nezet = valasztoNezet;
        final File kamera = kameraFajl;
        fajlValaszthivas = null;
        valasztoNezet = null;
        kameraFajl = null;
        kameraCim = null;

        final List<Uri> valasztott = new ArrayList<>();
        boolean kamerabol = false;

        if (eredmeny == RESULT_OK) {
            if (adat == null || (adat.getData() == null && adat.getClipData() == null)) {
                /* A kameraalkalmazás nem ad vissza adatot: a képet abba a
                   fájlba írta, amit mi adtunk meg neki. */
                if (kamera != null && kamera.length() > 0) {
                    kamerabol = true;
                }
            } else if (adat.getClipData() != null) {
                ClipData kivalasztott = adat.getClipData();
                for (int i = 0; i < kivalasztott.getItemCount(); i++) {
                    Uri cim = kivalasztott.getItemAt(i).getUri();
                    if (cim != null) {
                        valasztott.add(cim);
                    }
                }
            } else {
                valasztott.add(adat.getData());
            }
        }

        if (!kamerabol && kamera != null) {
            /* Nem fényképezett (vagy megszakította): az üres fájl törölhető. */
            //noinspection ResultOfMethodCallIgnored
            kamera.delete();
        }

        /* A visszahívás csak akkor él, ha a kérő nézet még a helyén van. Ha
           közben a rendszer leállította a megjelenítőt vagy az egész
           alkalmazást, a választott fájlokat függőbe tesszük, és az
           újratöltött oldal onnan veszi át őket. */
        final boolean elo = visszahivas != null && nezet != null && nezet == webView;

        if (!kamerabol && elo) {
            /* Galéria vagy fájlkezelő: a címek változatlanul mehetnek. */
            visszahivas.onReceiveValue(valasztott.isEmpty() ? null : valasztott.toArray(new Uri[0]));
            return;
        }

        if (!kamerabol && valasztott.isEmpty()) {
            return;
        }

        /* A fénykép kicsinyítése (és a függőbe tett fájlok másolása) a
           háttérben fut; a visszahívást MINDEN ágon meg kell hívni – különben
           a fájlmező örökre használhatatlan marad. */
        final boolean foto = kamerabol;
        hatter.execute(new Runnable() {
            @Override
            public void run() {
                final List<String> nevek = new ArrayList<>();
                if (foto) {
                    valasztott.add(Uri.fromFile(kamera));
                }
                for (Uri cim : valasztott) {
                    try {
                        nevek.add(atvetel.atvesz(cim, foto ? "foto" : "fajl"));
                    } catch (Exception | OutOfMemoryError e) {
                        Log.w(NAPLO, "A kiválasztott fájlt nem sikerült átvenni", e);
                    }
                }
                if (foto) {
                    //noinspection ResultOfMethodCallIgnored
                    kamera.delete();
                }

                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        atadas(elo ? visszahivas : null, nezet, nevek);
                    }
                });
            }
        });
    }

    /** A kész fájlok átadása: a fájlmezőnek, vagy – ha az már nem él – függőben. */
    private void atadas(ValueCallback<Uri[]> visszahivas, WebView nezet, List<String> nevek) {
        /* A kicsinyítés alatt is lecserélődhetett a nézet. */
        if (visszahivas != null && nezet != null && nezet == webView) {
            List<Uri> cimek = new ArrayList<>();
            for (String nev : nevek) {
                File f = atvetel.kiszolgalando(nev);
                if (f != null) {
                    try {
                        cimek.add(fajlCim(f));
                    } catch (IllegalArgumentException e) {
                        Log.w(NAPLO, "A fájl nem adható át", e);
                    }
                }
            }
            visszahivas.onReceiveValue(cimek.isEmpty() ? null : cimek.toArray(new Uri[0]));
            return;
        }

        if (nevek.isEmpty()) {
            return;
        }
        atvetel.fuggobe(nevek);
        /* Ha az oldal már betöltött, most szólunk neki; ha még nem, induláskor
           magától is rákérdez. */
        if (webView != null) {
            webView.evaluateJavascript(
                    "window.ocrFuggoAtvetel && window.ocrFuggoAtvetel()", null);
        }
    }

    private Uri fajlCim(File f) {
        return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
    }

    private void kameraTorlese() {
        if (kameraFajl != null) {
            //noinspection ResultOfMethodCallIgnored
            kameraFajl.delete();
        }
        kameraFajl = null;
        kameraCim = null;
    }

    private void regiFotokTorlese() {
        File[] regiek = new File(getFilesDir(), "fotok").listFiles();
        if (regiek == null) {
            return;
        }
        for (File f : regiek) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /* ------------------------------------------------------------------ *
     * Életciklus
     * ------------------------------------------------------------------ */

    @Override
    protected void onSaveInstanceState(Bundle allapot) {
        super.onSaveInstanceState(allapot);
        if (kameraFajl != null) {
            allapot.putString(ALLAPOT_KAMERAFAJL, kameraFajl.getAbsolutePath());
        }
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
        hatter.shutdown();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
