// npm install --prefix tmp/3d three@0.180.0 esbuild@0.25.9
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const hashes={};
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())visit(file);
  else if(file.endsWith('.glb'))hashes[file.replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}}
visit('assets/models');fs.writeFileSync('assets/models/hashes.json',JSON.stringify(hashes,null,2)+'\n');
require('../tmp/3d/node_modules/esbuild').buildSync({
  entryPoints:['js/characters3d.js'], bundle:true, minify:true, format:'iife',
  outfile:'js/vendor/characters3d.bundle.js', legalComments:'eof', target:'es2020'
});
