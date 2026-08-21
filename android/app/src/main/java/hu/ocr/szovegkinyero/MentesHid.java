package hu.ocr.szovegkinyero;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

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

    /** Android 10-től a Letöltések mappába írhatunk engedély nélkül. */
    private String mentesLetoltesekbe(String nev, String tartalom) throws IOException {
        ContentValues adatok = new ContentValues();
        adatok.put(MediaStore.Downloads.DISPLAY_NAME, nev);
        adatok.put(MediaStore.Downloads.MIME_TYPE, "text/markdown");
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
            ki.write(tartalom.getBytes(StandardCharsets.UTF_8));
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
            ki.write(tartalom.getBytes(StandardCharsets.UTF_8));
        } finally {
            ki.close();
        }

        megosztas(fajl);
        return fajl.getAbsolutePath();
    }

    private void megosztas(File fajl) {
        Uri cim = FileProvider.getUriForFile(
                activity, activity.getPackageName() + ".fileprovider", fajl);

        Intent szandek = new Intent(Intent.ACTION_SEND);
        szandek.setType("text/markdown");
        szandek.putExtra(Intent.EXTRA_STREAM, cim);
        szandek.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        activity.startActivity(Intent.createChooser(szandek, activity.getString(R.string.megosztas)));
    }

    private static String biztonsagosNev(String nev) {
        String tiszta = nev == null ? "" : nev.replaceAll("[\\\\/:*?\"<>|]+", "-").trim();
        if (tiszta.isEmpty()) {
            tiszta = "ocr-szoveg.md";
        }
        if (!tiszta.toLowerCase(java.util.Locale.ROOT).endsWith(".md")) {
            tiszta = tiszta + ".md";
        }
        return tiszta;
    }
}
