import { beforeEach, expect, it, vi } from "vitest";
const fs=vi.hoisted(()=>({createDirectory:vi.fn(),writeFile:vi.fn(),rename:vi.fn(),delete:vi.fn()}));
vi.mock("vscode",()=>({workspace:{fs},Uri:{joinPath:(_root:unknown,name:string)=>name}}));
import { LearningStore } from "../src/store.js";
import { defaultDocument } from "../src/model.js";
import type { ExtensionContext } from "vscode";
beforeEach(()=>{for(const method of Object.values(fs))method.mockReset().mockResolvedValue(undefined);});
it("serializes background and root-switch saves in submission order",async()=>{
 const store=new LearningStore({storageUri:{}} as ExtensionContext,"test");
 const written:string[]=[];let release:()=>void=()=>{};
 fs.writeFile.mockImplementationOnce(async(_uri,bytes)=>{written.push(JSON.parse(new TextDecoder().decode(bytes)).rootThreadId);await new Promise<void>(resolve=>{release=resolve;});});
 fs.writeFile.mockImplementation(async(_uri,bytes)=>{written.push(JSON.parse(new TextDecoder().decode(bytes)).rootThreadId);});
 const first=store.write({...defaultDocument("test"),rootThreadId:"a"});
 const second=store.write({...defaultDocument("test"),rootThreadId:"b"});
 await vi.waitFor(()=>expect(written).toEqual(["a"]));expect(fs.rename).not.toHaveBeenCalled();
 release();await Promise.all([first,second]);expect(written).toEqual(["a","b"]);expect(fs.rename).toHaveBeenCalledTimes(2);
});
it("allows later saves after a failed write",async()=>{
 const store=new LearningStore({storageUri:{}} as ExtensionContext,"test");
 fs.writeFile.mockRejectedValueOnce(new Error("disk unavailable"));
 await expect(store.write(defaultDocument("test"))).rejects.toThrow("disk unavailable");
 await expect(store.write(defaultDocument("test"))).resolves.toBeUndefined();expect(fs.rename).toHaveBeenCalledTimes(1);
});
