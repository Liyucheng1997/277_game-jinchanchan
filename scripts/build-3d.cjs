// npm install --prefix tmp/3d three@0.180.0 esbuild@0.25.9
require('../tmp/3d/node_modules/esbuild').buildSync({
  entryPoints:['js/characters3d.js'], bundle:true, minify:true, format:'iife',
  outfile:'js/vendor/characters3d.bundle.js', legalComments:'eof', target:'es2020'
});
