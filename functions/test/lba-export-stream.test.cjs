'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {gzipSync}=require('node:zlib');
const {
  parseOfferArrayStream,createOfferArrayScanner,readSignedExportStream,
}=require('../lib/lba-export-stream.cjs');
async function parseJson(value,split=7){
  const input=Buffer.from(value,'utf8');
  const result=[];
  const chunks=[];
  for(let i=0;i<input.length;i+=split) chunks.push(input.subarray(i,i+split));
  const report=await parseOfferArrayStream(Readable.from(chunks),r=>result.push(r));
  return {result,report};
}
test('stream root array, nested braces and escape tokens across chunks',async()=>{
  const data=[{offer:{title:'A "quote" { and [ }',rome_codes:['D1102']},identifier:{partner_label:'France Travail'}},
    {offer:{title:'Été à Paris \uD83C\uDF1E'},identifier:{partner_label:'Meteojob'}}];
  for(const step of [1,2,3,7,1024]){
    const got=await parseJson(JSON.stringify(data),step);
    assert.deepEqual(got.result,data);
    assert.equal(got.report.items,2);
  }
});
test('stream nested jobs array with metadata and skips unrelated array',async()=>{
  const data={meta:{other:[{ignored:true}]},data:{jobs:[{offer:{title:'A'}},{offer:{title:'B'}}]},end:'ok'};
  const got=await parseJson(JSON.stringify(data),5);
  assert.equal(got.report.items,2);
  assert.deepEqual(got.result,[{offer:{title:'A'}},{offer:{title:'B'}}]);
});
test('rejects incomplete JSON and unexpected arrays',async()=>{
  await assert.rejects(()=>parseJson('{"jobs":[{"offer":{}}'),/LBA_EXPORT_INCOMPLETE_ARRAY/);
  await assert.rejects(()=>parseJson('{"items2":[{"offer":{}}]}'),/LBA_EXPORT_INCOMPLETE_ARRAY/);
});
test('aborts oversized single record',()=>{
  const scanner=createOfferArrayScanner(()=>{},{maxItemChars:64});
  assert.throws(()=>scanner.write(Buffer.from(JSON.stringify([{item:'A'.repeat(180)}]))),
    /LBA_EXPORT_ITEM_TOO_LARGE/);
});
test('reads a signed gzip stream with decompression',async()=>{
  const data=[{offer:{title:'Économie'}},{identifier:{partner_label:'recruteurs_lba'}}];
  const bytes=gzipSync(Buffer.from(JSON.stringify(data)));
  const web=new ReadableStream({
    start(ctrl){ctrl.enqueue(bytes);ctrl.close();}
  });
  const got=[];
  const report=await readSignedExportStream({ok:true,body:web},r=>got.push(r));
  assert.deepEqual(got,data);
  assert.equal(report.gzip,true);
  assert.equal(report.items,2);
});
