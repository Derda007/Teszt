package hu.ocr.szovegkinyero;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * A weboldal Markdown-mentése natív úton.
 * <p>
 * A böngészős változat egy letöltési hivatkozást hoz létre, amit a WebView nem
 * kezel megbízhatóan (főleg blob: címeknél). Ezért a weboldal – ha ezt a hidat
 * megtalálja – inkább átadja ide a szöveget.
 */
public final class MentesHid {

    /** A weboldal ezen a néven éri el. */
    static final String NEV = "OcrAndroid";

    /** A base64 miatt a valódi méret ennek nagyjából háromnegyede. */
    private static final int MAX_BINARIS = 200 * 1024 * 1024;

    private final Activity activity;

    MentesHid(Activity activity) {
        this.activity = activity;
    }

    /**
     * @param fajlNev a javasolt fájlnév (pl. {@code szamla.md})
     * @param tartalom a Markdown szöveg
     */
    @JavascriptInterface
    public void mentes(final String fajlNev, final String tartalom) {
        final String nev = biztonsagosNev(fajlNev);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    String hol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? mentesLetoltesekbe(nev, tartalom)
                            : mentesSajatMappaba(nev, tartalom);
                    Toast.makeText(activity, activity.getString(R.string.mentve, hol),
                            Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(activity, activity.getString(R.string.mentes_hiba, e.getMessage()),
                            Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    /**
     * Bináris tartalom (ZIP) mentése. A weboldal base64-ben adja át, mert a
     * JavaScript és a Java között csak szöveg mehet.
     *
     * @param fajlNev a javasolt fájlnév (pl. {@code ocr-szoveg.zip})
     * @param base64 a fájl tartalma base64-ben
     * @param mime a tartalom típusa (pl. {@code application/zip})
     */
    @JavascriptInterface
    public void mentesBinaris(final String fajlNev, final String base64, final String mime) {
        final String nev = biztonsagosNev(fajlNev, ".zip");
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (base64 == null || base64.length() > MAX_BINARIS) {
                        throw new IOException("tul nagy allomany");
                    }
                    byte[] adat = Base64.decode(base64, Base64.DEFAULT);
                    String hol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? mentesLetoltesekbe(nev, adat, mime == null ? "application/zip" : mime)
                            : mentesSajatMappaba(nev, adat);
                    Toast.makeText(activity, activity.getString(R.string.mentve, hol),
                            Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(activity, activity.getString(R.string.mentes_hiba, e.getMessage()),
                            Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    /** Android 10-től a Letöltések mappába írhatunk engedély nélkül. */
    private String mentesLetoltesekbe(String nev, String tartalom) throws IOException {
        return mentesLetoltesekbe(nev, tartalom.getBytes(StandardCharsets.UTF_8), "text/markdown");
    }

    private String mentesLetoltesekbe(String nev, byte[] adat, String mime) throws IOException {
        ContentValues adatok = new ContentValues();
        adatok.put(MediaStore.Downloads.DISPLAY_NAME, nev);
        adatok.put(MediaStore.Downloads.MIME_TYPE, mime);
        adatok.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri cel = activity.getContentResolver()
                .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, adatok);
        if (cel == null) {
            throw new IOException("nem sikerult letrehozni a fajlt");
        }

        OutputStream ki = activity.getContentResolver().openOutputStream(cel);
        if (ki == null) {
            throw new IOException("nem sikerult megnyitni a fajlt");
        }
        try {
            ki.write(adat);
        } finally {
            ki.close();
        }

        adatok.clear();
        adatok.put(MediaStore.Downloads.IS_PENDING, 0);
        activity.getContentResolver().update(cel, adatok, null, null);

        return Environment.DIRECTORY_DOWNLOADS + "/" + nev;
    }

    /**
     * Régebbi rendszereken a Letöltések mappához külön engedély kellene, ezért
     * az alkalmazás saját, engedély nélkül írható könyvtárába mentünk, és
     * rögtön fel is kínáljuk megosztásra.
     */
    private String mentesSajatMappaba(String nev, String tartalom) throws IOException {
        return mentesSajatMappaba(nev, tartalom.getBytes(StandardCharsets.UTF_8));
    }

    private String mentesSajatMappaba(String nev, byte[] adat) throws IOException {
        File mappa = activity.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (mappa == null) {
            mappa = activity.getFilesDir();
        }
        if (!mappa.exists() && !mappa.mkdirs()) {
            throw new IOException("nem sikerult letrehozni a mappat");
        }

        File fajl = new File(mappa, nev);
        FileOutputStream ki = new FileOutputStream(fajl);
        try {
            ki.write(adat);
        } finally {
            ki.close();
        }

        megosztas(fajl, nev.toLowerCase(Locale.ROOT).endsWith(".zip")
                ? "application/zip" : "text/markdown");
        return fajl.getAbsolutePath();
    }

    private void megosztas(File fajl, String mime) {
        Uri cim = FileProvider.getUriForFile(
                activity, activity.getPackageName() + ".fileprovider", fajl);

        Intent szandek = new Intent(Intent.ACTION_SEND);
        szandek.setType(mime);
        szandek.putExtra(Intent.EXTRA_STREAM, cim);
        szandek.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        activity.startActivity(Intent.createChooser(szandek, activity.getString(R.string.megosztas)));
    }

    private static String biztonsagosNev(String nev) {
        return biztonsagosNev(nev, ".md");
    }

    private static String biztonsagosNev(String nev, String kiterjesztes) {
        String tiszta = nev == null ? "" : nev.replaceAll("[\\\\/:*?\"<>|]+", "-").trim();
        if (tiszta.isEmpty()) {
            tiszta = "ocr-szoveg" + kiterjesztes;
        }
        if (!tiszta.toLowerCase(Locale.ROOT).endsWith(kiterjesztes)) {
            tiszta = tiszta + kiterjesztes;
        }
        return tiszta;
    }
}
