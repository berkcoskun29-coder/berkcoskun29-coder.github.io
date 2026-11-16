var e=`(function () {
    'use strict';

    /* @ts-self-types="./df.d.ts" */

    // --- AudioWorklet polyfill ---------------------------------------------------
    // AudioWorkletGlobalScope has no TextDecoder/TextEncoder. wasm-bindgen 0.2.126
    // constructs \`new TextDecoder()\` at module top-level (unguarded), which throws
    // \`ReferenceError: TextDecoder is not defined\` inside a worklet and prevents
    // registerProcessor() from running. Provide minimal UTF-8 shims when absent.
    // (Only used for error/diagnostic strings; the audio path passes bytes/floats.)
    if (typeof TextDecoder === 'undefined') {
        globalThis.TextDecoder = class {
            decode(bytes) {
                if (!bytes) return '';
                const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
                let out = '';
                for (let i = 0; i < u8.length;) {
                    const c = u8[i++];
                    if (c < 0x80) out += String.fromCharCode(c);
                    else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (u8[i++] & 0x3F));
                    else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F));
                    else {
                        const cp = (((c & 0x07) << 18) | ((u8[i++] & 0x3F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F)) - 0x10000;
                        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
                    }
                }
                return out;
            }
        };
    }
    if (typeof TextEncoder === 'undefined') {
        globalThis.TextEncoder = class {
            encode(str) {
                const out = [];
                for (let i = 0; i < str.length; i++) {
                    let c = str.charCodeAt(i);
                    if (c < 0x80) out.push(c);
                    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
                    else if (c >= 0xD800 && c < 0xDC00) {
                        const c2 = str.charCodeAt(++i);
                        c = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
                        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
                    } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
                }
                return new Uint8Array(out);
            }
            encodeInto(str, dst) {
                const enc = this.encode(str);
                dst.set(enc);
                return { read: str.length, written: enc.length };
            }
        };
    }

    /**
     * Create a DeepFilterNet Model
     *
     * Args:
     *     - path: File path to a DeepFilterNet tar.gz onnx model
     *     - atten_lim: Attenuation limit in dB.
     *
     * Returns:
     *     - DF state doing the full processing: stft, DNN noise reduction, istft.
     * @param {Uint8Array} model_bytes
     * @param {number} atten_lim
     * @returns {number}
     */
    function df_create(model_bytes, atten_lim) {
        const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.df_create(ptr0, len0, atten_lim);
        return ret >>> 0;
    }

    /**
     * Get DeepFilterNet frame size in samples.
     * @param {number} st
     * @returns {number}
     */
    function df_get_frame_length(st) {
        const ret = wasm.df_get_frame_length(st);
        return ret >>> 0;
    }

    /**
     * Processes a chunk of samples.
     *
     * Args:
     *     - df_state: Created via df_create()
     *     - input: Input buffer of length df_get_frame_length()
     *     - output: Output buffer of length df_get_frame_length()
     *
     * Returns:
     *     - Local SNR of the current frame.
     * @param {number} st
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    function df_process_frame(st, input) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.df_process_frame(st, ptr0, len0);
        return ret;
    }

    /**
     * Set DeepFilterNet attenuation limit.
     *
     * Args:
     *     - lim_db: New attenuation limit in dB.
     * @param {number} st
     * @param {number} lim_db
     */
    function df_set_atten_lim(st, lim_db) {
        wasm.df_set_atten_lim(st, lim_db);
    }

    /**
     * Set DeepFilterNet post filter beta. A beta of 0 disables the post filter.
     *
     * Args:
     *     - beta: Post filter attenuation. Suitable range between 0.05 and 0;
     * @param {number} st
     * @param {number} beta
     */
    function df_set_post_filter_beta(st, beta) {
        wasm.df_set_post_filter_beta(st, beta);
    }
    function __wbg_get_imports() {
        const import0 = {
            __proto__: null,
            __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
                const ret = typeof(arg0) === 'function';
                return ret;
            },
            __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
                const val = arg0;
                const ret = typeof(val) === 'object' && val !== null;
                return ret;
            },
            __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
                const ret = typeof(arg0) === 'string';
                return ret;
            },
            __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
                const ret = arg0 === undefined;
                return ret;
            },
            __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
                throw new Error(getStringFromWasm0(arg0, arg1));
            },
            __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
                const ret = arg0.call(arg1, arg2);
                return ret;
            }, arguments); },
            __wbg_crypto_38df2bab126b63dc: function(arg0) {
                const ret = arg0.crypto;
                return ret;
            },
            __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
                arg0.getRandomValues(arg1);
            }, arguments); },
            __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
                const ret = arg0.length;
                return ret;
            },
            __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
                const ret = arg0.msCrypto;
                return ret;
            },
            __wbg_new_from_slice_ddf8b82c4d6af38e: function(arg0, arg1) {
                const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
                return ret;
            },
            __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
                const ret = new Uint8Array(arg0 >>> 0);
                return ret;
            },
            __wbg_node_84ea875411254db1: function(arg0) {
                const ret = arg0.node;
                return ret;
            },
            __wbg_process_44c7a14e11e9f69e: function(arg0) {
                const ret = arg0.process;
                return ret;
            },
            __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
                Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
            },
            __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
                arg0.randomFillSync(arg1);
            }, arguments); },
            __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
                const ret = module.require;
                return ret;
            }, arguments); },
            __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
                const ret = typeof global === 'undefined' ? null : global;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
                const ret = typeof globalThis === 'undefined' ? null : globalThis;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_SELF_146583524fe1469b: function() {
                const ret = typeof self === 'undefined' ? null : self;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
                const ret = typeof window === 'undefined' ? null : window;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
                const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
                return ret;
            },
            __wbg_versions_276b2795b1c6a219: function(arg0) {
                const ret = arg0.versions;
                return ret;
            },
            __wbindgen_cast_0000000000000001: function(arg0, arg1) {
                // Cast intrinsic for \`Ref(Slice(U8)) -> NamedExternref("Uint8Array")\`.
                const ret = getArrayU8FromWasm0(arg0, arg1);
                return ret;
            },
            __wbindgen_cast_0000000000000002: function(arg0, arg1) {
                // Cast intrinsic for \`Ref(String) -> Externref\`.
                const ret = getStringFromWasm0(arg0, arg1);
                return ret;
            },
            __wbindgen_init_externref_table: function() {
                const table = wasm.__wbindgen_externrefs;
                const offset = table.grow(4);
                table.set(0, undefined);
                table.set(offset + 0, undefined);
                table.set(offset + 1, null);
                table.set(offset + 2, true);
                table.set(offset + 3, false);
            },
        };
        return {
            __proto__: null,
            "./df_bg.js": import0,
        };
    }

    const DFStateFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_dfstate_free(ptr, 1));

    function addToExternrefTable0(obj) {
        const idx = wasm.__externref_table_alloc();
        wasm.__wbindgen_externrefs.set(idx, obj);
        return idx;
    }

    function getArrayF32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }

    let cachedFloat32ArrayMemory0 = null;
    function getFloat32ArrayMemory0() {
        if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
            cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
        }
        return cachedFloat32ArrayMemory0;
    }

    function getStringFromWasm0(ptr, len) {
        return decodeText(ptr >>> 0, len);
    }

    let cachedUint8ArrayMemory0 = null;
    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function handleError(f, args) {
        try {
            return f.apply(this, args);
        } catch (e) {
            const idx = addToExternrefTable0(e);
            wasm.__wbindgen_exn_store(idx);
        }
    }

    function isLikeNone(x) {
        return x === undefined || x === null;
    }

    function passArray8ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 1, 1) >>> 0;
        getUint8ArrayMemory0().set(arg, ptr / 1);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    function passArrayF32ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 4, 4) >>> 0;
        getFloat32ArrayMemory0().set(arg, ptr / 4);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    const MAX_SAFARI_DECODE_BYTES = 2146435072;
    let numBytesDecoded = 0;
    function decodeText(ptr, len) {
        numBytesDecoded += len;
        if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
            cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
            cachedTextDecoder.decode();
            numBytesDecoded = len;
        }
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    let WASM_VECTOR_LEN = 0;

    let wasmModule, wasmInstance, wasm;
    function __wbg_finalize_init(instance, module) {
        wasmInstance = instance;
        wasm = instance.exports;
        wasmModule = module;
        cachedFloat32ArrayMemory0 = null;
        cachedUint8ArrayMemory0 = null;
        wasm.__wbindgen_start();
        return wasm;
    }


    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (module !== undefined) {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for \`initSync()\`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();
        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }
        const instance = new WebAssembly.Instance(module, imports);
        return __wbg_finalize_init(instance, module);
    }

    const WorkletMessageTypes = {
        SET_SUPPRESSION_LEVEL: 'SET_SUPPRESSION_LEVEL',
        SET_BYPASS: 'SET_BYPASS'
    };

    class DeepFilterAudioProcessor extends AudioWorkletProcessor {
        constructor(options) {
            super();
            this.dfModel = null;
            this.inputWritePos = 0;
            this.inputReadPos = 0;
            this.outputWritePos = 0;
            this.outputReadPos = 0;
            this.bypass = false;
            this.isInitialized = false;
            this.tempFrame = null;
            this.bufferSize = 8192;
            this.inputBuffer = new Float32Array(this.bufferSize);
            this.outputBuffer = new Float32Array(this.bufferSize);
            try {
                // Initialize WASM from pre-compiled module
                initSync({ module: options.processorOptions.wasmModule }); // Voxen: tek nesne (eski parametre uyarısı çıkmasın)
                const modelBytes = new Uint8Array(options.processorOptions.modelBytes);
                const handle = df_create(modelBytes, options.processorOptions.suppressionLevel ?? 50);
                const frameLength = df_get_frame_length(handle);
                this.dfModel = { handle, frameLength };
                this.bufferSize = frameLength * 4;
                this.inputBuffer = new Float32Array(this.bufferSize);
                this.outputBuffer = new Float32Array(this.bufferSize);
                // Pre-allocate temp frame buffer for processing
                this.tempFrame = new Float32Array(frameLength);
                this.isInitialized = true;
                this.port.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
                // Voxen (v0.29.3): kurulum bitti
                this.port.postMessage({ tip: 'hazir' });
            }
            catch (error) {
                console.error('Failed to initialize DeepFilter in AudioWorklet:', error);
                this.isInitialized = false;
                // Voxen (v0.29.3): kurulum hatası ana iş parçacığına (RNNoise'a düşülsün)
                this.port.postMessage({ tip: 'hata', mesaj: String((error && error.message) || error) });
            }
        }
        handleMessage(data) {
            switch (data.type) {
                case WorkletMessageTypes.SET_SUPPRESSION_LEVEL:
                    if (this.dfModel && typeof data.value === 'number') {
                        const level = Math.max(0, Math.min(100, Math.floor(data.value)));
                        df_set_atten_lim(this.dfModel.handle, level);
                    }
                    break;
                case WorkletMessageTypes.SET_BYPASS:
                    this.bypass = Boolean(data.value);
                    break;
            }
        }
        getInputAvailable() {
            return (this.inputWritePos - this.inputReadPos + this.bufferSize) % this.bufferSize;
        }
        getOutputAvailable() {
            return (this.outputWritePos - this.outputReadPos + this.bufferSize) % this.bufferSize;
        }
        process(inputList, outputList) {
            const sourceLimit = Math.min(inputList.length, outputList.length);
            const input = inputList[0]?.[0];
            if (!input) {
                return true;
            }
            // Passthrough mode - copy input to all output channels
            if (!this.isInitialized || !this.dfModel || this.bypass || !this.tempFrame) {
                for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                    const output = outputList[inputNum];
                    const channelCount = output.length;
                    for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                        output[channelNum].set(input);
                    }
                }
                return true;
            }
            // Write input to ring buffer
            for (let i = 0; i < input.length; i++) {
                this.inputBuffer[this.inputWritePos] = input[i];
                this.inputWritePos = (this.inputWritePos + 1) % this.bufferSize;
            }
            const frameLength = this.dfModel.frameLength;
            while (this.getInputAvailable() >= frameLength) {
                // Extract frame from ring buffer
                for (let i = 0; i < frameLength; i++) {
                    this.tempFrame[i] = this.inputBuffer[this.inputReadPos];
                    this.inputReadPos = (this.inputReadPos + 1) % this.bufferSize;
                }
                let processed;
                try {
                    processed = df_process_frame(this.dfModel.handle, this.tempFrame);
                }
                catch (error) {
                    // Voxen (v0.29.3): wasm çöktü; bir kez bildir, sonraki bloklarda işlemeden geçir
                    this.isInitialized = false;
                    this.port.postMessage({ tip: 'hata', mesaj: String((error && error.message) || error) });
                    return true;
                }
                // Write to output ring buffer
                for (let i = 0; i < processed.length; i++) {
                    this.outputBuffer[this.outputWritePos] = processed[i];
                    this.outputWritePos = (this.outputWritePos + 1) % this.bufferSize;
                }
            }
            const outputAvailable = this.getOutputAvailable();
            if (outputAvailable >= 128) {
                for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                    const output = outputList[inputNum];
                    const channelCount = output.length;
                    for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                        const outputChannel = output[channelNum];
                        let readPos = this.outputReadPos;
                        for (let i = 0; i < 128; i++) {
                            outputChannel[i] = this.outputBuffer[readPos];
                            readPos = (readPos + 1) % this.bufferSize;
                        }
                    }
                }
                this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
            }
            return true;
        }
    }
    registerProcessor('deepfilter-audio-processor', DeepFilterAudioProcessor);

})();
`;export{e as workletCode};