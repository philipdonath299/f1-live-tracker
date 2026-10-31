import { mkdir, copyFile } from 'node:fs/promises';
const assets=['index.html','css/pitwall.css','js/pitwall.js','js/pitwall-timing.js','js/pitwall-track.js','js/free-model.js','js/free-live.js','js/free-ui.js'];
for(const file of assets){await mkdir(`dist/${file.slice(0,file.lastIndexOf('/')+1)}`,{recursive:true});await copyFile(file,`dist/${file}`);}
console.log('Built the pit wall in dist/. Vercel serves api/f1.js as a Node function.');
