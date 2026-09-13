// Content-addressed disk cache: loading a cached model never contacts the server.
export function createModelStore(hashes, env=globalThis) {
  const pending=new Map(), stats={hits:0,downloads:0,writes:0,storageErrors:0};
  let disk;
  async function open() {
    if(!disk) disk=Promise.resolve().then(()=>env.caches.open('jinchanchan-models-v1')).catch(()=>{stats.storageErrors++;return null;});
    return disk;
  }
  async function read(path) {
    if(pending.has(path))return pending.get(path);
    const task=(async()=>{
      const url=new URL(path,env.location.href);url.searchParams.set('sha256',hashes[path]);
      const cache=await open();
      let cached;try{cached=await cache?.match(url.href);}catch{stats.storageErrors++;}
      if(cached){stats.hits++;return cached.arrayBuffer();}
      const response=await env.fetch(url.href);
      if(!response.ok)throw new Error('Model HTTP '+response.status);
      const bytes=await response.arrayBuffer(), view=new DataView(bytes);
      if(bytes.byteLength<12||view.getUint32(0,true)!==0x46546c67||view.getUint32(8,true)!==bytes.byteLength)throw new Error('Invalid GLB');
      const digest=await env.crypto.subtle.digest('SHA-256',bytes);
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==hashes[path])throw new Error('Model checksum mismatch');
      stats.downloads++;
      if(cache)try{await cache.put(url.href,new Response(bytes,{headers:{'Content-Type':'model/gltf-binary'}}));stats.writes++;}catch{stats.storageErrors++;}
      return bytes;
    })();
    pending.set(path,task);
    try{return await task;}finally{pending.delete(path);}
  }
  async function downloadAll(progress=()=>{}) {
    let done=0,failed=0;const paths=Object.keys(hashes);
    // One background download at a time avoids competing with active heroes.
    for(const path of paths){try{await read(path);}catch{failed++;}progress(++done,paths.length,failed);await new Promise(r=>setTimeout(r,0));}
    return {done,failed,persistent:!!await open()&&stats.storageErrors===0};
  }
  return {read,downloadAll,stats};
}
