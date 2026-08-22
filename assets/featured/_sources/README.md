# Featured key art — sources

The full-resolution originals (1672x941 PNG) behind `assets/featured/<slug>.webp`.
They live here so a future re-crop or re-encode never depends on a file still
sitting on someone's desktop — which is exactly how the first set was nearly lost.

Named by registry slug, so source and output line up. Regenerate one with:

    cwebp -q 82 -resize 1200 675 _sources/<slug>.png -o <slug>.webp

`word-kraven.webp` has no source here; its original was gone before this folder
existed. Everything else round-trips.

Not deployed — `.vercelignore` keeps this directory out of the build, so it costs
the live site nothing.
