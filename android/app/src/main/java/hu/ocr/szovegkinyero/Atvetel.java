package hu.ocr.szovegkinyero;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Fájlok átadása a natív oldalról a weboldalnak: vágólapról beillesztett kép,
 * és az a fénykép vagy kiválasztott fájl, amelyet a weboldal már nem tudott
 * átvenni (mert közben a rendszer leállította a megjelenítőt vagy az egész
 * alkalmazást).
 * <p>
 * A képeket itt, natívan kicsinyítjük. Egy mai telefon kamerája 50 megapixeles
 * képet is készít, amit a böngészőmotor kitömörítve 200 MB-nyi memóriában
 * tartana – ettől állt le korábban az alkalmazás fényképezés után.
 * <p>
 * Az átadott fájlokat a weboldal a saját eredetéről, a {@link #UTVONAL} alól
 * tölti le; ezeket az {@link EszkozKiszolgalo} szolgálja ki.
 */
final class Atvetel {

    /** A weboldal ezen a néven éri el. */
    static final String NEV = "OcrAndroidAtvetel";

    /** Ez alatt az útvonal alatt érhetők el az átadott fájlok. */
    static final String UTVONAL = "/_atadas/";

    /** Ugyanannyi, mint a weboldal MAX_SIDE értéke Androidon. */
    private static final int MAX_OLDAL = 2400;

    private static final String NAPLO = "OcrAtvetel";

    private final Activity activity;
    private final File mappa;
    private final ClipboardManager vagolap;

    /** A weboldalnak még át nem adott fájlok nevei. */
    private final List<String> fuggo = new ArrayList<>();

    private int sorszam = 1;

    Atvetel(Activity activity) {
        this.activity = activity;
        this.mappa = new File(activity.getCacheDir(), "atadas");
        /* A főszálon kérjük el: a rendszer itt köti a főszál üzenetsorához. */
        this.vagolap = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
    }

    /** Friss indításkor a korábbi, már átadott fájlok törölhetők. */
    void takaritas() {
        File[] regiek = mappa.listFiles();
        if (regiek == null) {
            return;
        }
        for (File f : regiek) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /**
     * @return a kiszolgálandó fájl, vagy {@code null}, ha a név nem egy
     *         általunk létrehozott, egyszerű fájlnév
     */
    File kiszolgalando(String nev) {
        if (nev == null || !nev.matches("[A-Za-z0-9._-]+") || nev.startsWith(".")) {
            return null;
        }
        File f = new File(mappa, nev);
        return f.isFile() ? f : null;
    }

    /* ------------------------------------------------------------------ *
     * A weboldal felé
     * ------------------------------------------------------------------ */

    /**
     * A vágólapon lévő képek (vagy PDF) átvétele.
     *
     * @return JSON: {@code {"fajlok":["vagolap-….jpg"]}}, vagy hiba esetén
     *         {@code {"hiba":"ures"|"olvasas"}}
     */
    @JavascriptInterface
    public String vagolapKep() {
        JSONObject valasz = new JSONObject();
        try {
            ClipData klip = vagolap == null ? null : vagolap.getPrimaryClip();
            JSONArray nevek = new JSONArray();
            boolean voltKep = false;

            if (klip != null) {
                ClipDescription leiras = klip.getDescription();
                for (int i = 0; i < klip.getItemCount(); i++) {
                    Uri cim = klip.getItemAt(i).getUri();
                    if (cim == null) {
                        continue;
                    }
                    String tipus = tipus(cim, leiras);
                    if (tipus == null
                            || !(tipus.startsWith("image/") || tipus.equals("application/pdf"))) {
                        continue;
                    }
                    voltKep = true;
                    try {
                        nevek.put(atvesz(cim, "vagolap"));
                    } catch (Exception | OutOfMemoryError e) {
                        Log.w(NAPLO, "A vágólap egyik elemét nem sikerült átvenni", e);
                    }
                }
            }

            if (nevek.length() == 0) {
                valasz.put("hiba", voltKep ? "olvasas" : "ures");
            } else {
                valasz.put("fajlok", nevek);
            }
        } catch (Exception e) {
            Log.w(NAPLO, "A vágólap nem olvasható", e);
            try {
                valasz.put("hiba", "olvasas");
            } catch (Exception ignored) {
                return "{\"hiba\":\"olvasas\"}";
            }
        }
        return valasz.toString();
    }

    /** A függőben lévő fájlok nevei JSON-tömbben; a listát ki is üríti. */
    @JavascriptInterface
    public String fuggoFajlok() {
        synchronized (fuggo) {
            JSONArray nevek = new JSONArray(fuggo);
            fuggo.clear();
            return nevek.toString();
        }
    }

    void fuggobe(List<String> nevek) {
        synchronized (fuggo) {
            fuggo.addAll(nevek);
        }
    }

    /* ------------------------------------------------------------------ *
     * Átvétel és kicsinyítés
     * ------------------------------------------------------------------ */

    /**
     * Egy tartalom átmásolása az átadási mappába; a nagy képeket közben a
     * {@link #MAX_OLDAL} méretre kicsinyítjük és a helyes állásba forgatjuk.
     *
     * @return az új fájl neve (a mappán belül)
     */
    String atvesz(Uri cim, String elotag) throws IOException {
        if (!mappa.exists() && !mappa.mkdirs()) {
            throw new IOException("nem sikerult letrehozni az atadasi mappat");
        }

        String tipus = tipus(cim, null);
        String alap = elotag + "-"
                + new SimpleDateFormat("HHmmss", Locale.US).format(new Date())
                + "-" + kovetkezoSorszam();

        if (tipus != null && tipus.startsWith("image/")) {
            File kicsinyitett = new File(mappa, alap + ".jpg");
            if (kicsinyit(cim, kicsinyitett)) {
                return kicsinyitett.getName();
            }
        }

        /* Kicsinyíteni nem kellett vagy nem lehetett: változatlan másolat. */
        File cel = new File(mappa, alap + "." + kiterjesztes(tipus));
        masol(cim, cel);
        return cel.getName();
    }

    /**
     * @return {@code true}, ha elkészült a kicsinyített (vagy elforgatott)
     *         JPEG; {@code false}, ha a kép maradhat, ahogy van, vagy a
     *         rendszer nem tudja dekódolni (pl. TIFF)
     */
    private boolean kicsinyit(Uri cim, File cel) throws IOException {
        BitmapFactory.Options meret = new BitmapFactory.Options();
        meret.inJustDecodeBounds = true;
        try (InputStream be = megnyit(cim)) {
            BitmapFactory.decodeStream(be, null, meret);
        }
        if (meret.outWidth <= 0 || meret.outHeight <= 0) {
            return false;
        }

        int fordulat = elforgatas(cim);
        int hosszu = Math.max(meret.outWidth, meret.outHeight);
        if (hosszu <= MAX_OLDAL && fordulat == 0) {
            return false;
        }

        int minta = 1;
        while (hosszu / (minta * 2) >= MAX_OLDAL) {
            minta *= 2;
        }

        Bitmap kep = null;
        /* Ha így is kevés a memória, durvább mintavétellel próbálkozunk. */
        for (int proba = 0; proba < 3 && kep == null; proba++) {
            BitmapFactory.Options opciok = new BitmapFactory.Options();
            opciok.inSampleSize = minta;
            try (InputStream be = megnyit(cim)) {
                kep = BitmapFactory.decodeStream(be, null, opciok);
            } catch (OutOfMemoryError e) {
                minta *= 2;
            }
        }
        if (kep == null) {
            throw new IOException("a kep nem dekodolhato");
        }

        try {
            float arany = Math.min(1f, (float) MAX_OLDAL / Math.max(kep.getWidth(), kep.getHeight()));
            if (arany < 1f || fordulat != 0) {
                Matrix m = new Matrix();
                if (arany < 1f) {
                    m.postScale(arany, arany);
                }
                if (fordulat != 0) {
                    m.postRotate(fordulat);
                }
                Bitmap uj = Bitmap.createBitmap(kep, 0, 0, kep.getWidth(), kep.getHeight(), m, true);
                if (uj != kep) {
                    kep.recycle();
                    kep = uj;
                }
            }

            try (OutputStream ki = new FileOutputStream(cel)) {
                if (!kep.compress(Bitmap.CompressFormat.JPEG, 95, ki)) {
                    throw new IOException("a kep nem mentheto");
                }
            }
            return true;
        } finally {
            kep.recycle();
        }
    }

    /** Az EXIF szerinti elforgatás fokban (0, 90, 180, 270). */
    private int elforgatas(Uri cim) {
        try (InputStream be = megnyit(cim)) {
            int irany = new ExifInterface(be).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            switch (irany) {
                case ExifInterface.ORIENTATION_ROTATE_90:
                    return 90;
                case ExifInterface.ORIENTATION_ROTATE_180:
                    return 180;
                case ExifInterface.ORIENTATION_ROTATE_270:
                    return 270;
                default:
                    return 0;
            }
        } catch (Exception e) {
            return 0;
        }
    }

    private void masol(Uri cim, File cel) throws IOException {
        try (InputStream be = megnyit(cim); OutputStream ki = new FileOutputStream(cel)) {
            byte[] puffer = new byte[64 * 1024];
            int n;
            while ((n = be.read(puffer)) > 0) {
                ki.write(puffer, 0, n);
            }
        }
    }

    private InputStream megnyit(Uri cim) throws IOException {
        InputStream be = activity.getContentResolver().openInputStream(cim);
        if (be == null) {
            throw new IOException("nem nyithato meg: " + cim);
        }
        return be;
    }

    private String tipus(Uri cim, ClipDescription leiras) {
        String tipus = null;
        try {
            tipus = activity.getContentResolver().getType(cim);
        } catch (Exception ignored) {
            /* nem minden szolgáltató adja meg */
        }
        if (tipus == null && ContentResolver.SCHEME_FILE.equals(cim.getScheme())) {
            String kit = MimeTypeMap.getFileExtensionFromUrl(cim.toString());
            tipus = MimeTypeMap.getSingleton().getMimeTypeFromExtension(kit.toLowerCase(Locale.ROOT));
        }
        if (tipus == null && leiras != null && leiras.getMimeTypeCount() > 0) {
            tipus = leiras.getMimeType(0);
        }
        return tipus == null ? null : tipus.toLowerCase(Locale.ROOT);
    }

    private static String kiterjesztes(String tipus) {
        String kit = tipus == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(tipus);
        return kit == null || !kit.matches("[a-z0-9]+") ? "bin" : kit;
    }

    private synchronized int kovetkezoSorszam() {
        return sorszam++;
    }
}
