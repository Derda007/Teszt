package hu.ocr.szovegkinyero;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Nyomkövetés arra az esetre, ha az alkalmazás munka közben leáll.
 * <p>
 * A weboldal minden feldolgozási lépésnél szól ide; ha a folyamat közben a
 * rendszer leállítja az alkalmazást, a következő indításkor kiderül, melyik
 * lépésnél történt, és – Android 11-től – a rendszer szerint miért
 * (memóriahiány, összeomlás stb.). Ezt a felhasználó egy gombnyomással
 * kimásolhatja és továbbküldheti.
 */
final class Diagnosztika {

    /** A weboldal ezen a néven éri el. */
    static final String NEV = "OcrAndroidNaplo";

    private static final String TAG = "OcrDiagnosztika";
    private static final String BEALLITASOK = "diagnosztika";
    private static final String MUNKA = "munka";
    private static final String MUNKA_IDEJE = "munka_ideje";
    private static final String ESEMENYEK = "esemenyek";
    private static final int MAX_ESEMENY = 6000;

    private final Context kornyezet;
    private final SharedPreferences tar;

    Diagnosztika(Context kornyezet) {
        this.kornyezet = kornyezet.getApplicationContext();
        this.tar = this.kornyezet.getSharedPreferences(BEALLITASOK, Context.MODE_PRIVATE);
    }

    /** A Java-oldali, el nem kapott hibák feljegyzése (utána a rendszer
     *  a szokásos módon leállítja az alkalmazást). */
    void hibakezeloTelepitese() {
        final Thread.UncaughtExceptionHandler eredeti = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread szal, Throwable hiba) {
                try {
                    StringWriter sw = new StringWriter();
                    hiba.printStackTrace(new PrintWriter(sw));
                    String nyom = sw.toString();
                    if (nyom.length() > 2500) {
                        nyom = nyom.substring(0, 2500) + "…";
                    }
                    esemeny("Java-hiba (" + szal.getName() + "): " + nyom, true);
                } catch (Throwable ignored) {
                    /* a hibakezelő maga ne okozzon újabb hibát */
                }
                if (eredeti != null) {
                    eredeti.uncaughtException(szal, hiba);
                }
            }
        });
    }

    /* ------------------------------------------------------------------ *
     * A weboldal felé
     * ------------------------------------------------------------------ */

    /** Egy feldolgozási lépés kezdete (pl. "foto-….jpg · szöveg felismerése"). */
    @JavascriptInterface
    public void lepes(String leiras) {
        /* commit(): a bejegyzésnek egy azonnali leállást is túl kell élnie. */
        tar.edit()
                .putString(MUNKA, leiras == null ? "" : leiras)
                .putLong(MUNKA_IDEJE, System.currentTimeMillis())
                .commit();
    }

    /** A munka rendben befejeződött (vagy hibával, de leállás nélkül). */
    @JavascriptInterface
    public void kesz() {
        tar.edit().remove(MUNKA).remove(MUNKA_IDEJE).commit();
    }

    /** Tetszőleges megjegyzés a naplóba (pl. a weboldal hibaüzenete). */
    @JavascriptInterface
    public void megjegyzes(String szoveg) {
        esemeny("Oldal: " + szoveg, false);
    }

    /* ------------------------------------------------------------------ *
     * Natív események
     * ------------------------------------------------------------------ */

    void esemeny(String szoveg, boolean azonnal) {
        Log.w(TAG, szoveg);
        String ido = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        String eddigi = tar.getString(ESEMENYEK, "");
        String uj = eddigi + "[" + ido + "] " + szoveg + "\n";
        if (uj.length() > MAX_ESEMENY) {
            uj = uj.substring(uj.length() - MAX_ESEMENY);
        }
        SharedPreferences.Editor e = tar.edit().putString(ESEMENYEK, uj);
        if (azonnal) {
            e.commit();
        } else {
            e.apply();
        }
    }

    /**
     * @return jelentés az előző futás leállásáról, vagy {@code null}, ha az
     *         előző munka rendben lezárult. A hívás után a nyomok törlődnek.
     */
    String elozoLeallas() {
        String munka = tar.getString(MUNKA, null);
        if (munka == null) {
            /* Rendben lezárult munka után a régi események sem kellenek. */
            tar.edit().remove(ESEMENYEK).apply();
            return null;
        }
        long mikor = tar.getLong(MUNKA_IDEJE, 0);

        StringBuilder j = new StringBuilder();
        j.append("Utolsó lépés: ").append(munka).append('\n');
        if (mikor > 0) {
            j.append("Időpont: ")
                    .append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(mikor)))
                    .append('\n');
        }
        j.append("Készülék: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
                .append(", Android ").append(Build.VERSION.RELEASE)
                .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        j.append("Alkalmazás: ").append(alkalmazasVerzio(kornyezet)).append('\n');
        j.append("WebView: ").append(webViewVerzio()).append('\n');

        ActivityManager am = (ActivityManager) kornyezet.getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
            ActivityManager.MemoryInfo mem = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mem);
            j.append("Memória: ").append(mem.totalMem / (1024 * 1024)).append(" MB összesen")
                    .append(am.isLowRamDevice() ? ", kis memóriájú készülék" : "").append('\n');

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                kilepesiOk(am, mikor, j);
            }
        }

        String esemenyek = tar.getString(ESEMENYEK, "");
        if (!esemenyek.isEmpty()) {
            j.append("Események:\n").append(esemenyek);
        }

        tar.edit().remove(MUNKA).remove(MUNKA_IDEJE).remove(ESEMENYEK).commit();
        return j.toString();
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.R)
    private static void kilepesiOk(ActivityManager am, long mikor, StringBuilder j) {
        try {
            List<ApplicationExitInfo> okok = am.getHistoricalProcessExitReasons(null, 0, 3);
            for (ApplicationExitInfo ok : okok) {
                if (mikor > 0 && ok.getTimestamp() < mikor - 60_000) {
                    continue;
                }
                j.append("Rendszer szerinti ok: ").append(okNeve(ok.getReason()));
                if (ok.getDescription() != null) {
                    j.append(" – ").append(ok.getDescription());
                }
                j.append(" (folyamat: ").append(ok.getProcessName())
                        .append(", memória: ").append(ok.getPss() / 1024).append(" MB PSS")
                        .append(")\n");
            }
        } catch (Exception e) {
            j.append("Rendszer szerinti ok: nem kérdezhető le (").append(e.getMessage()).append(")\n");
        }
    }

    private static String okNeve(int ok) {
        switch (ok) {
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "memóriahiány (LOW_MEMORY)";
            case ApplicationExitInfo.REASON_CRASH:
                return "Java-összeomlás (CRASH)";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "natív összeomlás (CRASH_NATIVE)";
            case ApplicationExitInfo.REASON_ANR:
                return "nem válaszolt (ANR)";
            case ApplicationExitInfo.REASON_SIGNALED:
                return "a rendszer leállította (SIGNALED)";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return "túl nagy erőforrás-használat";
            case ApplicationExitInfo.REASON_USER_REQUESTED:
                return "a felhasználó leállította";
            case ApplicationExitInfo.REASON_OTHER:
                return "egyéb (OTHER)";
            default:
                return "kód: " + ok;
        }
    }

    private static String webViewVerzio() {
        try {
            android.content.pm.PackageInfo csomag = WebView.getCurrentWebViewPackage();
            return csomag == null ? "ismeretlen" : csomag.packageName + " " + csomag.versionName;
        } catch (Exception e) {
            return "ismeretlen";
        }
    }

    private static String alkalmazasVerzio(Context k) {
        try {
            return k.getPackageManager().getPackageInfo(k.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "ismeretlen";
        }
    }
}
