import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, normalizeImage } from "./image-validation";
import { imageMessageInput } from "./chat-images";
import { randomUUID } from "node:crypto";

test("images are decoded, normalized and stripped of metadata", async () => {
  const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: "red" } }).jpeg().withMetadata().toBuffer();
  const output = await normalizeImage(input);
  const meta = await sharp(output.bytes).metadata();
  assert.equal(meta.format,"webp"); assert.equal(meta.width,16); assert.equal(meta.height,12);
  assert.equal(meta.exif,undefined); assert.equal(meta.icc,undefined);
  await assert.rejects(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')));
  await assert.rejects(normalizeImage(Buffer.from("not an image")));
  await assert.rejects(normalizeImage(Buffer.alloc(MAX_IMAGE_BYTES+1)));
  const huge = await sharp({create:{width:6000,height:6000,channels:3,background:"red"}}).png().toBuffer();
  await assert.rejects(normalizeImage(huge));
});
test("image messages require text or bounded unique image IDs and a retry ID", () => {
  const clientMessageId=randomUUID(), id=randomUUID();
  assert.deepEqual(imageMessageInput({body:"",clientMessageId,imageIds:[id]}).p_images,[id]);
  assert.deepEqual(imageMessageInput({body:"text",clientMessageId}).p_images,[]);
  for(const imageIds of [[id,id],Array.from({length:5},()=>randomUUID()),["../other"],"bad",[null]])
    assert.throws(()=>imageMessageInput({body:"",clientMessageId,imageIds}));
  assert.throws(()=>imageMessageInput({body:"",clientMessageId}));
  assert.throws(()=>imageMessageInput({body:"text",clientMessageId},true));
});
