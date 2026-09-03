/**
 * AI 工作台 - 媒体工具箱（纯浏览器本地处理，不上传文件）
 * 视频：预览 / 区间裁剪（MediaRecorder 原生编码）/ 抽帧 PNG
 * 音频：预览 / 波形 / 区间裁剪 / WAV-MP3 互转（WAV 内置编码，MP3 用 lamejs）
 * 文档：PDF 预览/合并/拆分/旋转（pdf.js + pdf-lib）、txt/md 预览编辑导出、
 *       docx 预览（docx-preview）+ 文本提取
 * AI 总结：复用「AI 聊天」页 localStorage 中的本地 / 云端 OpenAI 兼容配置
 */
/* global pdfjsLib, JSZip, docx, lamejs */

(function () {
  'use strict';

  // ============ DOM ============
  function D(id) { return document.getElementById(id); }
  var els = {
    headerTitle: D('headerTitle'),
    toolTabs: D('toolTabs'),
    panelVideo: D('panelVideo'),
    panelAudio: D('panelAudio'),
    panelDocs: D('panelDocs'),
    // 视频
    videoDrop: D('videoDrop'), videoFile: D('videoFile'),
    videoMeta: D('videoMeta'), videoPlayer: D('videoPlayer'),
    videoStart: D('videoStart'), videoEnd: D('videoEnd'),
    videoDuration: D('videoDuration'), btnTrim: D('btnTrim'),
    btnFrame: D('btnFrame'), videoStatus: D('videoStatus'),
    // 音频
    audioDrop: D('audioDrop'), audioFile: D('audioFile'),
    audioMeta: D('audioMeta'), audioPlayer: D('audioPlayer'),
    waveform: D('waveform'),
    audioStart: D('audioStart'), audioEnd: D('audioEnd'),
    audioDuration: D('audioDuration'),
    audioTrimFormat: D('audioTrimFormat'), btnAudioTrim: D('btnAudioTrim'),
    audioConvertFormat: D('audioConvertFormat'), btnAudioConvert: D('btnAudioConvert'),
    audioStatus: D('audioStatus'),
    // PDF
    pdfDrop: D('pdfDrop'), pdfFiles: D('pdfFiles'),
    pdfFilesBox: D('pdfFilesBox'), pdfTarget: D('pdfTarget'),
    btnPdfMerge: D('btnPdfMerge'), btnPdfSplit: D('btnPdfSplit'),
    pdfRotateDeg: D('pdfRotateDeg'), btnPdfRotate: D('btnPdfRotate'),
    pdfPreviewArea: D('pdfPreviewArea'), pdfCanvas: D('pdfCanvas'),
    btnPdfPrev: D('btnPdfPrev'), btnPdfNext: D('btnPdfNext'),
    pdfPageInfo: D('pdfPageInfo'), btnPdfText: D('btnPdfText'),
    pdfStatus: D('pdfStatus'),
    // 文本
    textDrop: D('textDrop'), textFile: D('textFile'),
    textMeta: D('textMeta'), textEditor: D('textEditor'),
    btnTextSave: D('btnTextSave'), btnTextAi: D('btnTextAi'),
    textStatus: D('textStatus'),
    // docx
    docxDrop: D('docxDrop'), docxFile: D('docxFile'),
    docxPreview: D('docxPreview'), btnDocxAi: D('btnDocxAi'),
    docxStatus: D('docxStatus'),
    // AI 结果
    aiResult: D('aiResult'), btnAiCopy: D('btnAiCopy'), aiStatus: D('aiStatus')
  };

  // ============ 状态 ============
  var videoFile = null, videoUrl = null, videoAudioTied = false, trimRaf = null;
  var audioBuffer = null, audioCtx = null, audioUrl = null, audioName = '';
  var pdfDocs = [];            // [{name, bytes}]
  var pdfJsDoc = null;         // 当前预览的 pdf.js 文档
  var pdfCurrentPage = 1, pdfTotalPages = 1;
  var currentTextName = '', docxText = '';

  // ============ 工具函数 ============
  function setMsg(el, text, kind) {
    el.textContent = text;
    el.className = 'msg-line' + (kind === 'err' ? ' err' : (kind === 'ok' ? ' ok' : ''));
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(1) + ' ' + u[i];
  }

  function baseName(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  function extName(name) {
    var i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  }

  function waitEvent(target, name) {
    return new Promise(function (resolve) {
      target.addEventListener(name, function () { resolve(); }, { once: true });
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // 拖拽 + 点击选择统一绑定
  function bindDrop(dropEl, inputEl, handler) {
    dropEl.addEventListener('click', function () { inputEl.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('dragover'); });
    });
    dropEl.addEventListener('drop', function (e) {
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) handler(files);
    });
    inputEl.addEventListener('change', function () {
      if (inputEl.files && inputEl.files.length) handler(Array.prototype.slice.call(inputEl.files));
      inputEl.value = '';
    });
  }

  // ============ Tab 切换 ============
  var panelMap = { video: 'panelVideo', audio: 'panelAudio', docs: 'panelDocs' };
  var titleMap = {
    video: '媒体工具箱 · 视频处理',
    audio: '媒体工具箱 · 音频处理',
    docs: '媒体工具箱 · 文档处理'
  };
  Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      var tab = btn.getAttribute('data-tab');
      Object.keys(panelMap).forEach(function (t) {
        els[panelMap[t]].hidden = (t !== tab);
      });
      els.headerTitle.textContent = titleMap[tab] || '媒体工具箱';
    });
  });

  // ============================================================
  //  视频处理
  // ============================================================
  bindDrop(els.videoDrop, els.videoFile, function (files) {
    var file = files[0];
    if (!file || file.type.indexOf('video/') !== 0) {
      setMsg(els.videoStatus, '请选择视频文件。', 'err'); return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoFile = file;
    videoUrl = URL.createObjectURL(file);
    var v = els.videoPlayer;
    v.src = videoUrl;
    v.hidden = false;
    els.videoMeta.textContent = file.name + '（' + fmtBytes(file.size) + '）';
    setMsg(els.videoStatus, '正在载入视频…');
    v.onloadedmetadata = function () {
      var dur = v.duration;
      if (isFinite(dur)) {
        els.videoEnd.value = round2(dur);
        els.videoDuration.textContent = '总时长 ' + round2(dur) + ' 秒';
      }
      setMsg(els.videoStatus, '视频已载入：设置区间可裁剪；播放到目标画面后点「截取当前帧」导出图片。', 'ok');
    };
    v.onerror = function () {
      setMsg(els.videoStatus, '无法解码该视频：浏览器不支持此编码。建议使用 MP4（H.264）或 WebM（VP8/VP9）。', 'err');
    };
  });

  function makeVideoCanvas() {
    var c = document.createElement('canvas');
    var w = Math.max(2, Math.floor(els.videoPlayer.videoWidth / 2) * 2);
    var h = Math.max(2, Math.floor(els.videoPlayer.videoHeight / 2) * 2);
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d'), w: w, h: h };
  }

  // 视频元素音频接管到 MediaStream（若可用），保留原声
  function tieVideoAudio(stream) {
    if (videoAudioTied) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var srcNode = ctx.createMediaElementSource(els.videoPlayer);
      var dest = ctx.createMediaStreamDestination();
      srcNode.connect(dest);
      srcNode.connect(ctx.destination);
      var tracks = dest.stream.getAudioTracks();
      if (tracks.length) stream.addTrack(tracks[0]);
      videoAudioTied = true;
    } catch (e) { /* 无音频轨道也可继续 */ }
  }

  function seekVideo(t) {
    var v = els.videoPlayer;
    if (Math.abs(v.currentTime - t) < 0.02) return Promise.resolve();
    var p = waitEvent(v, 'seeked');
    v.currentTime = t;
    return p;
  }

  function playVideo() {
    var v = els.videoPlayer;
    if (!v.paused) return Promise.resolve();
    return v.play();
  }

  els.btnTrim.addEventListener('click', function () {
    trimVideo();
  });

  async function trimVideo() {
    if (!videoFile) { setMsg(els.videoStatus, '请先上传视频。', 'err'); return; }
    var v = els.videoPlayer;
    if (!v.duration || !isFinite(v.duration)) { setMsg(els.videoStatus, '视频尚未就绪，请等待载入完成。', 'err'); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setMsg(els.videoStatus, '当前浏览器不支持画面流录制（需 MediaRecorder + canvas.captureStream），请使用最新版 Chrome / Edge / Firefox。', 'err');
      return;
    }
    var dur = v.duration;
    var st = parseFloat(els.videoStart.value);
    var en = parseFloat(els.videoEnd.value);
    if (isNaN(st)) st = 0;
    if (isNaN(en)) en = dur;
    st = Math.max(0, Math.min(st, dur));
    en = Math.max(0, Math.min(en, dur));
    if (en - st < 0.1) { setMsg(els.videoStatus, '区间过短：结束时间须大于开始时间 0.1 秒以上。', 'err'); return; }
    els.videoStart.value = round2(st);
    els.videoEnd.value = round2(en);

    var mc = makeVideoCanvas();
    var stream;
    try { stream = mc.canvas.captureStream(30); } catch (e) {
      setMsg(els.videoStatus, '无法创建画面流：' + String(e.message || e), 'err'); return;
    }
    tieVideoAudio(stream);

    var mime = null;
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].forEach(function (c) {
      if (!mime && window.MediaRecorder.isTypeSupported(c)) mime = c;
    });
    if (!mime) { setMsg(els.videoStatus, '浏览器不支持可用的视频编码格式，无法导出。', 'err'); return; }

    setMsg(els.videoStatus, '正在跳转到开始位置…');
    try { await seekVideo(st); } catch (e) {
      setMsg(els.videoStatus, '跳转失败：' + String(e.message || e), 'err'); return;
    }
    try { await playVideo(); } catch (e) {
      setMsg(els.videoStatus, '无法自动播放（浏览器限制），请先手动点击播放一次后再裁剪。', 'err'); return;
    }

    var chunks = [];
    var rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime }); }
    catch (e) { setMsg(els.videoStatus, '启动录制失败：' + String(e.message || e), 'err'); return; }
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var stoppedP = new Promise(function (resolve) { rec.onstop = resolve; });
    rec.start(300);
    els.btnTrim.disabled = true;
    var span = en - st;

    var tick = function () {
      if (rec.state !== 'recording') return;
      mc.ctx.drawImage(v, 0, 0, mc.w, mc.h);
      var pct = Math.min(100, ((v.currentTime - st) / span) * 100);
      setMsg(els.videoStatus, '实时裁剪中 ' + pct.toFixed(0) + '%（用时约等于片段时长，请保持本页可见）…');
      if (v.currentTime >= en - 0.06 || v.paused || v.ended) {
        try { rec.stop(); } catch (e) { /* ignore */ }
      } else {
        trimRaf = requestAnimationFrame(tick);
      }
    };
    trimRaf = requestAnimationFrame(tick);
    var safety = setTimeout(function () {
      if (rec.state === 'recording') { try { rec.stop(); } catch (e) { /* ignore */ } }
    }, span * 1000 + 5000);

    await stoppedP;
    clearTimeout(safety);
    if (trimRaf) cancelAnimationFrame(trimRaf);
    try { v.pause(); } catch (e) { /* ignore */ }

    var type = mime.split(';')[0];
    var ext = type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var blob = new Blob(chunks, { type: type });
    if (blob.size < 1024) {
      setMsg(els.videoStatus, '导出失败：录制内容为空（可能浏览器不支持该来源录制）。', 'err');
    } else {
      download(blob, baseName(videoFile.name) + '_trim_' + round2(st) + '-' + round2(en) + '.' + ext);
      setMsg(els.videoStatus, '已导出片段（' + ext.toUpperCase() + '，约 ' + round2(en - st) + ' 秒）。', 'ok');
    }
    els.btnTrim.disabled = false;
  }

  els.btnFrame.addEventListener('click', function () {
    if (!videoFile) { setMsg(els.videoStatus, '请先上传视频。', 'err'); return; }
    var v = els.videoPlayer;
    var mc = makeVideoCanvas();
    mc.ctx.drawImage(v, 0, 0, mc.w, mc.h);
    mc.canvas.toBlob(function (b) {
      if (!b) { setMsg(els.videoStatus, '截图失败。', 'err'); return; }
      var t = new Date();
      var stamp = t.getFullYear() + '' + (t.getMonth() + 1) + '' + t.getDate() + '_' +
        t.getHours() + '' + t.getMinutes() + '' + t.getSeconds();
      download(b, baseName(videoFile.name) + '_frame_' + stamp + '.png');
      setMsg(els.videoStatus, '已截取当前帧导出 PNG（画面取当前播放/暂停位置）。', 'ok');
    }, 'image/png');
  });

  // ============================================================
  //  音频处理
  // ============================================================
  function getAudioCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) { /* ignore */ } }
    return audioCtx;
  }

  function drawWaveform(buf) {
    var c = els.waveform;
    c.hidden = false;
    var dpr = window.devicePixelRatio || 1;
    var cssW = c.clientWidth || 800;
    c.width = Math.floor(cssW * dpr);
    c.height = Math.floor(100 * dpr);
    var g = c.getContext('2d');
    g.fillStyle = '#17181d';
    g.fillRect(0, 0, c.width, c.height);
    var data = buf.getChannelData(0);
    var w = c.width;
    var per = Math.max(1, Math.floor(data.length / w));
    var mid = c.height / 2;
    g.fillStyle = '#4f8cff';
    for (var x = 0; x < w; x++) {
      var minV = 1, maxV = -1;
      var start = x * per, end = Math.min(data.length, start + per);
      for (var i = start; i < end; i++) {
        if (data[i] < minV) minV = data[i];
        if (data[i] > maxV) maxV = data[i];
      }
      var y1 = mid - maxV * mid * 0.92;
      var y2 = mid - minV * mid * 0.92;
      if (y2 - y1 < 1) y2 = y1 + 1;
      g.fillRect(x, y1, 1, y2 - y1);
    }
  }

  bindDrop(els.audioDrop, els.audioFile, function (files) {
    var file = files[0];
    if (!file || file.type.indexOf('audio/') !== 0) {
      setMsg(els.audioStatus, '请选择音频文件。', 'err'); return;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioName = file.name;
    audioUrl = URL.createObjectURL(file);
    var p = els.audioPlayer;
    p.src = audioUrl;
    p.hidden = false;
    els.audioMeta.textContent = file.name + '（' + fmtBytes(file.size) + '）';
    setMsg(els.audioStatus, '正在解码音频…');
    file.arrayBuffer().then(function (buf) {
      var ctx = getAudioCtx();
      if (!ctx) throw new Error('浏览器不支持 Web Audio API');
      return ctx.decodeAudioData(buf);
    }).then(function (decoded) {
      audioBuffer = decoded;
      var dur = decoded.duration;
      if (isFinite(dur)) {
        els.audioEnd.value = round2(dur);
        els.audioDuration.textContent = '总时长 ' + round2(dur) + ' 秒 · ' + decoded.numberOfChannels + 'ch · ' + decoded.sampleRate + 'Hz';
      }
      drawWaveform(decoded);
      setMsg(els.audioStatus, '已解码并生成波形。可设置区间裁剪导出，或整段格式转换。', 'ok');
    }).catch(function (err) {
      setMsg(els.audioStatus, '浏览器无法解码该音频（' + String(err.message || err) + '）。OGG 在部分浏览器（如 Safari）不支持；请更换为 MP3/WAV/M4A。', 'err');
    });
  });

  // —— 编码器 ——
  function sliceBuffer(buf, st, en) {
    var sr = buf.sampleRate;
    var s0 = Math.max(0, Math.round(st * sr));
    var s1 = Math.min(buf.length, Math.round(en * sr));
    var len = Math.max(1, s1 - s0);
    var nb = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    for (var ch = 0; ch < buf.numberOfChannels; ch++) {
      nb.getChannelData(ch).set(buf.getChannelData(ch).subarray(s0, s1));
    }
    return nb;
  }

  function writeStr(dv, off, s) {
    for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  }

  // 16bit PCM WAV 编码
  function encodeWavBlob(buf) {
    var nc = buf.numberOfChannels;
    var sr = buf.sampleRate;
    var len = buf.length;
    var block = nc * 2;
    var dataSize = len * block;
    var ab = new ArrayBuffer(44 + dataSize);
    var dv = new DataView(ab);
    writeStr(dv, 0, 'RIFF');
    dv.setUint32(4, 36 + dataSize, true);
    writeStr(dv, 8, 'WAVE');
    writeStr(dv, 12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, nc, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * block, true);
    dv.setUint16(32, block, true);
    dv.setUint16(34, 16, true);
    writeStr(dv, 36, 'data');
    dv.setUint32(40, dataSize, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nc; c++) {
        var s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
        dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function floatTo16(pcm) {
    var out = new Int16Array(pcm.length);
    for (var i = 0; i < pcm.length; i++) {
      var s = Math.max(-1, Math.min(1, pcm[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  // 128kbps MP3 编码（lamejs）
  function encodeMp3Blob(buf) {
    if (!window.lamejs) throw new Error('MP3 编码库（lamejs）未能从 CDN 加载，请改用 WAV 导出');
    var ch = Math.min(2, buf.numberOfChannels);
    var sr = buf.sampleRate;
    var lch = floatTo16(buf.getChannelData(0));
    var rch = null;
    if (ch === 2) rch = floatTo16(buf.getChannelData(1));
    var enc = new lamejs.Mp3Encoder(ch, sr, 128);
    var block = 1152;
    var parts = [];
    for (var i = 0; i < lch.length; i += block) {
      var left = lch.subarray(i, i + block);
      var right = ch === 2 ? rch.subarray(i, i + block) : null;
      var mp3buf = ch === 2 ? enc.encodeBuffer(left, right) : enc.encodeBuffer(left);
      if (mp3buf.length) parts.push(new Int8Array(mp3buf));
    }
    var end = enc.flush();
    if (end.length) parts.push(new Int8Array(end));
    var size = 0;
    parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size);
    var off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return new Blob([out], { type: 'audio/mpeg' });
  }

  function encodeBuffer(buf, fmt) {
    return fmt === 'mp3' ? encodeMp3Blob(buf) : encodeWavBlob(buf);
  }

  function pickRange(buf, startEl, endEl) {
    var dur = buf.duration;
    var st = parseFloat(startEl.value);
    var en = parseFloat(endEl.value);
    if (isNaN(st)) st = 0;
    if (isNaN(en)) en = dur;
    st = Math.max(0, Math.min(st, dur));
    en = Math.max(0, Math.min(en, dur));
    if (en - st < 0.1) return null;
    startEl.value = round2(st);
    endEl.value = round2(en);
    return { st: st, en: en, dur: dur };
  }

  els.btnAudioTrim.addEventListener('click', function () {
    if (!audioBuffer) { setMsg(els.audioStatus, '请先上传并解码音频。', 'err'); return; }
    var r = pickRange(audioBuffer, els.audioStart, els.audioEnd);
    if (!r) { setMsg(els.audioStatus, '区间过短：结束时间须大于开始时间 0.1 秒以上。', 'err'); return; }
    var fmt = els.audioTrimFormat.value;
    var nb = sliceBuffer(audioBuffer, r.st, r.en);
    setMsg(els.audioStatus, '正在编码 ' + fmt.toUpperCase() + '…');
    try {
      var blob = encodeBuffer(nb, fmt);
      download(blob, baseName(audioName || 'audio') + '_trim_' + round2(r.st) + '-' + round2(r.en) + '.' + fmt);
      setMsg(els.audioStatus, '已导出裁剪片段（' + round2(r.en - r.st) + ' 秒 / ' + fmt.toUpperCase() + '）。', 'ok');
    } catch (e) {
      setMsg(els.audioStatus, '编码失败：' + String(e.message || e), 'err');
    }
  });

  els.btnAudioConvert.addEventListener('click', function () {
    if (!audioBuffer) { setMsg(els.audioStatus, '请先上传并解码音频。', 'err'); return; }
    var fmt = els.audioConvertFormat.value;
    setMsg(els.audioStatus, '正在转换 ' + fmt.toUpperCase() + '…');
    try {
      var blob = encodeBuffer(audioBuffer, fmt);
      download(blob, baseName(audioName || 'audio') + '.' + fmt);
      setMsg(els.audioStatus, '已导出整段音频（' + fmt.toUpperCase() + '）。', 'ok');
    } catch (e) {
      setMsg(els.audioStatus, '转换失败：' + String(e.message || e), 'err');
    }
  });

  // ============================================================
  //  文档：PDF
  // ============================================================
  function pdfLibNs() {
    if (window.PDFLib && window.PDFLib.PDFDocument) return window.PDFLib;
    return null;
  }

  function renderPdfList() {
    els.pdfFilesBox.innerHTML = '';
    if (!pdfDocs.length) {
      els.pdfFilesBox.innerHTML = '<div class="file-item"><span class="file-name muted-text">尚未添加 PDF 文件</span></div>';
      return;
    }
    pdfDocs.forEach(function (doc, idx) {
      var row = document.createElement('div');
      row.className = 'file-item';
      var nm = document.createElement('span');
      nm.className = 'file-name';
      nm.textContent = doc.name;
      var sub = document.createElement('span');
      sub.className = 'file-sub';
      sub.textContent = fmtBytes(doc.bytes.byteLength || doc.bytes.length);
      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '移除';
      del.addEventListener('click', function () {
        pdfDocs.splice(idx, 1);
        if (pdfJsDoc) { try { pdfJsDoc.destroy(); } catch (e) { /* ignore */ } pdfJsDoc = null; }
        els.pdfPreviewArea.hidden = true;
        renderPdfList();
        renderPdfTarget();
      });
      row.appendChild(nm); row.appendChild(sub); row.appendChild(del);
      els.pdfFilesBox.appendChild(row);
    });
  }

  function renderPdfTarget() {
    els.pdfTarget.innerHTML = '';
    if (!pdfDocs.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '（无文件）';
      els.pdfTarget.appendChild(o0);
      return;
    }
    pdfDocs.forEach(function (doc, idx) {
      var o = document.createElement('option');
      o.value = String(idx);
      o.textContent = doc.name;
      els.pdfTarget.appendChild(o);
    });
  }

  function currentPdfIndex() {
    var val = els.pdfTarget.value;
    return val === '' || val === null ? -1 : parseInt(val, 10);
  }

  bindDrop(els.pdfDrop, els.pdfFiles, function (files) {
    var valid = files.filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
    if (!valid.length) { setMsg(els.pdfStatus, '请选择 PDF 文件。', 'err'); return; }
    var reads = valid.map(function (f) {
      return f.arrayBuffer().then(function (b) {
        pdfDocs.push({ name: f.name, bytes: b });
      });
    });
    Promise.all(reads).then(function () {
      renderPdfList();
      renderPdfTarget();
      els.pdfTarget.selectedIndex = pdfDocs.length - 1;
      setMsg(els.pdfStatus, '已添加 ' + valid.length + ' 个 PDF。可预览/合并/拆分/旋转。', 'ok');
      loadPdfPreview(currentPdfIndex());
    });
  });

  function ensurePdfJs() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return window.pdfjsLib;
    }
    return null;
  }

  function renderPdfPage(pageNo) {
    if (!pdfJsDoc) return Promise.resolve();
    var page = null;
    return pdfJsDoc.getPage(pageNo).then(function (pg) {
      page = pg;
      var vp = pg.getViewport({ scale: 1.4 });
      els.pdfCanvas.width = Math.floor(vp.width);
      els.pdfCanvas.height = Math.floor(vp.height);
      var ctx = els.pdfCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, els.pdfCanvas.width, els.pdfCanvas.height);
      return pg.render({ canvasContext: ctx, viewport: vp }).promise;
    }).then(function () {
      els.pdfPageInfo.textContent = pageNo + ' / ' + pdfTotalPages;
    });
  }

  function loadPdfPreview(idx) {
    var lib = ensurePdfJs();
    if (idx < 0 || !pdfDocs[idx]) {
      els.pdfPreviewArea.hidden = true;
      return;
    }
    if (!lib) {
      setMsg(els.pdfStatus, 'PDF 解析库（pdf.js）未能从 CDN 加载，无法预览，但合并/拆分/旋转仍可用。', 'err');
      return;
    }
    els.pdfPreviewArea.hidden = false;
    setMsg(els.pdfStatus, '正在解析 PDF…');
    if (pdfJsDoc) { try { pdfJsDoc.destroy(); } catch (e) { /* ignore */ } pdfJsDoc = null; }
    lib.getDocument({ data: new Uint8Array(pdfDocs[idx].bytes) }).promise.then(function (doc) {
      pdfJsDoc = doc;
      pdfTotalPages = doc.numPages;
      pdfCurrentPage = 1;
      return renderPdfPage(1);
    }).then(function () {
      setMsg(els.pdfStatus, 'PDF 预览就绪（共 ' + pdfTotalPages + ' 页）。', 'ok');
    }).catch(function (err) {
      setMsg(els.pdfStatus, 'PDF 解析失败：' + String(err.message || err), 'err');
    });
  }

  els.pdfTarget.addEventListener('change', function () {
    loadPdfPreview(currentPdfIndex());
  });
  els.btnPdfPrev.addEventListener('click', function () {
    if (!pdfJsDoc) return;
    if (pdfCurrentPage > 1) { pdfCurrentPage--; renderPdfPage(pdfCurrentPage); }
  });
  els.btnPdfNext.addEventListener('click', function () {
    if (!pdfJsDoc) return;
    if (pdfCurrentPage < pdfTotalPages) { pdfCurrentPage++; renderPdfPage(pdfCurrentPage); }
  });

  els.btnPdfMerge.addEventListener('click', function () {
    var ns = pdfLibNs();
    if (!pdfDocs.length) { setMsg(els.pdfStatus, '请先添加 PDF 文件。', 'err'); return; }
    if (!ns) { setMsg(els.pdfStatus, 'pdf-lib 未能从 CDN 加载，无法合并。', 'err'); return; }
    if (pdfDocs.length === 1) {
      setMsg(els.pdfStatus, '仅 1 个文件时无需合并，可直接导出原文件。', 'err'); return;
    }
    setMsg(els.pdfStatus, '正在合并 ' + pdfDocs.length + ' 个 PDF…');
    var out = ns.PDFDocument.create();
    var chain = out;
    pdfDocs.forEach(function (doc) {
      chain = chain.then(function (docOut) {
        return ns.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (src) {
          return docOut.copyPages(src, src.getPageIndices()).then(function (pages) {
            pages.forEach(function (p) { docOut.addPage(p); });
            return docOut;
          });
        });
      });
    });
    chain.then(function (docOut) { return docOut.save(); })
      .then(function (bytes) {
        download(new Blob([bytes], { type: 'application/pdf' }), 'merged_' + pdfDocs.length + 'files.pdf');
        setMsg(els.pdfStatus, '合并完成，已导出 ' + pdfDocs.length + ' 个 PDF 的合并文件。', 'ok');
      })
      .catch(function (err) {
        setMsg(els.pdfStatus, '合并失败：' + String(err.message || err), 'err');
      });
  });

  els.btnPdfSplit.addEventListener('click', function () {
    var ns = pdfLibNs();
    var idx = currentPdfIndex();
    if (!ns) { setMsg(els.pdfStatus, 'pdf-lib 未能从 CDN 加载，无法拆分。', 'err'); return; }
    if (idx < 0) { setMsg(els.pdfStatus, '请先在列表选择要拆分的 PDF（或重新添加）。', 'err'); return; }
    if (!window.JSZip) { setMsg(els.pdfStatus, 'JSZip 未能从 CDN 加载，无法打包。', 'err'); return; }
    var doc = pdfDocs[idx];
    setMsg(els.pdfStatus, '正在拆分 ' + doc.name + '…');
    ns.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (src) {
      var total = src.getPageCount();
      var zip = new JSZip();
      var base = baseName(doc.name);
      var tasks = [];
      for (var i = 0; i < total; i++) {
        (function (pageIdx) {
          tasks.push(ns.PDFDocument.create().then(function (d2) {
            return d2.copyPages(src, [pageIdx]).then(function (pages) {
              d2.addPage(pages[0]);
              return d2.save();
            }).then(function (b) {
              zip.file(base + '_page' + (pageIdx + 1) + '.pdf', b);
            });
          }));
        })(i);
      }
      return Promise.all(tasks).then(function () { return zip.generateAsync({ type: 'blob' }); });
    }).then(function (blob) {
      download(blob, baseName(doc.name) + '_split.zip');
      setMsg(els.pdfStatus, '拆分完成，已导出 ZIP（含全部单页 PDF）。', 'ok');
    }).catch(function (err) {
      setMsg(els.pdfStatus, '拆分失败：' + String(err.message || err), 'err');
    });
  });

  els.btnPdfRotate.addEventListener('click', function () {
    var ns = pdfLibNs();
    var idx = currentPdfIndex();
    if (!ns) { setMsg(els.pdfStatus, 'pdf-lib 未能从 CDN 加载，无法旋转。', 'err'); return; }
    if (idx < 0) { setMsg(els.pdfStatus, '请先在列表选择要旋转的 PDF。', 'err'); return; }
    var deg = parseInt(els.pdfRotateDeg.value, 10) || 90;
    var doc = pdfDocs[idx];
    setMsg(els.pdfStatus, '正在旋转 ' + doc.name + '（' + deg + '°）…');
    ns.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (src) {
      src.getPages().forEach(function (p) {
        p.setRotation(ns.degrees(((p.getRotation().angle) || 0) + deg));
      });
      return src.save();
    }).then(function (bytes) {
      pdfDocs[idx].bytes = bytes;
      renderPdfList();
      var targetName = baseName(doc.name) + '_rot' + deg + '.pdf';
      download(new Blob([bytes], { type: 'application/pdf' }), targetName);
      setMsg(els.pdfStatus, '旋转完成并已导出 ' + targetName + '。', 'ok');
      if (pdfJsDoc) { try { pdfJsDoc.destroy(); } catch (e) { /* ignore */ } pdfJsDoc = null; }
      els.pdfPreviewArea.hidden = true;
    }).catch(function (err) {
      setMsg(els.pdfStatus, '旋转失败：' + String(err.message || err), 'err');
    });
  });

  els.btnPdfText.addEventListener('click', function () {
    var idx = currentPdfIndex();
    var lib = ensurePdfJs();
    if (!lib) { setMsg(els.pdfStatus, 'pdf.js 未能从 CDN 加载，无法提取文本。', 'err'); return; }
    if (idx < 0) { setMsg(els.pdfStatus, '请先添加并选择 PDF。', 'err'); return; }
    setMsg(els.pdfStatus, '正在提取文本层…');
    lib.getDocument({ data: new Uint8Array(pdfDocs[idx].bytes) }).promise.then(function (doc) {
      var maxPages = Math.min(doc.numPages, 10);
      var parts = [];
      var seq = Promise.resolve();
      for (var i = 1; i <= maxPages; i++) {
        (function (pn) {
          seq = seq.then(function () {
            return doc.getPage(pn).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
              var s = (tc.items || []).map(function (it) { return it.str || ''; }).join(' ');
              parts.push('【第 ' + pn + ' 页】' + s);
            });
          });
        })(i);
      }
      return seq.then(function () {
        if (doc.numPages > maxPages) parts.push('…（PDF 共 ' + doc.numPages + ' 页，仅提取前 ' + maxPages + ' 页用于总结）');
        var text = parts.join('\n');
        if (text.replace(/\s+/g, '').length < 20) {
          throw new Error('未检测到文本层（可能是扫描版/图片 PDF），无法用文本方式总结');
        }
        return text;
      });
    }).then(function (text) {
      setMsg(els.pdfStatus, '文本提取完成（' + text.length + ' 字符），正在请求 AI 总结…', 'ok');
      return aiSummarize(text);
    }).catch(function (err) {
      setMsg(els.pdfStatus, '提取文本失败：' + String(err.message || err), 'err');
    });
  });

  // ============================================================
  //  文档：TXT / Markdown
  // ============================================================
  bindDrop(els.textDrop, els.textFile, function (files) {
    var f = files[0];
    if (!f) return;
    currentTextName = f.name;
    els.textMeta.textContent = f.name + '（' + fmtBytes(f.size) + '）';
    var reader = new FileReader();
    reader.onload = function () {
      els.textEditor.value = String(reader.result || '');
      setMsg(els.textStatus, '已载入文本（' + els.textEditor.value.length + ' 字符），可直接编辑后导出，或点击 AI 总结。', 'ok');
    };
    reader.onerror = function () { setMsg(els.textStatus, '读取文件失败。', 'err'); };
    reader.readAsText(f, 'utf-8');
  });

  els.btnTextSave.addEventListener('click', function () {
    var content = els.textEditor.value;
    if (!currentTextName && !content) { setMsg(els.textStatus, '暂无可导出的内容。', 'err'); return; }
    var name = currentTextName || 'untitled.txt';
    var ext = extName(name);
    if (ext !== 'txt' && ext !== 'md' && ext !== 'markdown') name = baseName(name) + '.txt';
    download(new Blob([content], { type: 'text/plain;charset=utf-8' }), name);
    setMsg(els.textStatus, '已导出 ' + name + '。', 'ok');
  });

  els.btnTextAi.addEventListener('click', function () {
    var content = els.textEditor.value.trim();
    if (!content) { setMsg(els.textStatus, '请先上传或输入文本内容。', 'err'); return; }
    setMsg(els.textStatus, '正在请求 AI 总结…');
    aiSummarize(content);
  });

  // ============================================================
  //  文档：DOCX
  // ============================================================
  bindDrop(els.docxDrop, els.docxFile, function (files) {
    var f = files[0];
    if (!f || !/\.docx$/i.test(f.name)) { setMsg(els.docxStatus, '请选择 .docx 文件。', 'err'); return; }
    setMsg(els.docxStatus, '正在渲染预览并提取文本…');
    f.arrayBuffer().then(function (buf) {
      var renderP = window.docx ?
        docx.renderAsync(buf, els.docxPreview, null, { inWrapper: true, ignoreWidth: false, ignoreHeight: false }) :
        Promise.reject(new Error('docx-preview 未能从 CDN 加载'));
      var extractP = window.JSZip ?
        new JSZip().loadAsync(buf).then(function (zip) {
          var entry = zip.file('word/document.xml');
          if (!entry) return Promise.reject(new Error('文档中没有 word/document.xml（可能不是标准 .docx）'));
          return entry.async('string').then(function (xml) {
            var text = xml.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
              .replace(/\n{3,}/g, '\n\n').trim();
            docxText = text;
            return text;
          });
        }) :
        Promise.reject(new Error('JSZip 未能从 CDN 加载'));
      return Promise.all([renderP, extractP]);
    }).then(function (results) {
      setMsg(els.docxStatus, '预览完成（提取文本 ' + results[1].length + ' 字符），可点击「AI 总结本文档」。', 'ok');
    }).catch(function (err) {
      setMsg(els.docxStatus, '处理失败：' + String(err.message || err), 'err');
    });
  });

  els.btnDocxAi.addEventListener('click', function () {
    if (!docxText.trim()) { setMsg(els.docxStatus, '请先上传并成功解析 .docx 文档。', 'err'); return; }
    setMsg(els.docxStatus, '正在请求 AI 总结…');
    aiSummarize(docxText);
  });

  // ============================================================
  //  AI 总结：复用 AI 聊天页配置
  // ============================================================
  function buildAIConfig() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('ai-workbench-config') || '{}'); } catch (e) { /* ignore */ }
    if (saved.mode === 'cloud') {
      var cBase = String(saved.cloudBase || '').trim().replace(/\/+$/, '');
      var cKey = String(saved.cloudKey || '').trim();
      var cModel = String(saved.cloudModel || '').trim();
      if (!cBase || !cKey || !cModel) {
        return Promise.resolve({ err: '云端 API 未配置完整：请先到「AI 聊天」页面切换到云端模式并填写 Base URL / API Key / 模型名（会自动保存）。' });
      }
      if (!/^https:\/\//i.test(cBase)) {
        return Promise.resolve({ err: '云端 Base URL 必须以 https:// 开头（云端请求强制 https）。' });
      }
      return Promise.resolve({ url: cBase + '/chat/completions', key: cKey, model: cModel, label: '云端 · ' + cModel });
    }
    // 本地模式（默认）
    var base = String(saved.apiBase || 'http://127.0.0.1:1234').trim().replace(/\/+$/, '');
    var key = String(saved.apiKey || '').trim();
    return fetch(base + '/v1/models', { signal: AbortSignal.timeout(6000) }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      var models = (data.data || []);
      if (!models.length) throw new Error('服务未加载任何模型');
      return { url: base + '/v1/chat/completions', key: key, model: models[0].id, label: '本地 · ' + models[0].id };
    }).catch(function (e) {
      return { err: '无法连接本地模型服务（' + String(e.message || e) + '）。请确认 LM Studio 已启动，或到「AI 聊天」页切换到云端模式并填写 https Base URL / Key / 模型。' };
    });
  }

  function aiSummarize(content) {
    return buildAIConfig().then(function (cfg) {
      if (cfg.err) {
        els.aiResult.value = cfg.err;
        setMsg(els.aiStatus, cfg.err, 'err');
        return;
      }
      setMsg(els.aiStatus, '正在请求 ' + cfg.label + ' 生成总结…');
      var prompt = '请对下面这份文档内容做中文总结：先一句话概括全文，再分点列出关键要点。只输出总结内容，不要额外寒暄。\n\n文档内容：\n' + content.trim().slice(0, 30000);
      var headers = { 'Content-Type': 'application/json' };
      if (cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
      return fetch(cfg.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      }).then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 150)); });
        return res.json();
      }).then(function (data) {
        var out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!out) throw new Error('模型未返回内容');
        els.aiResult.value = String(out).trim();
        setMsg(els.aiStatus, 'AI 总结完成。', 'ok');
      }).catch(function (e) {
        els.aiResult.value = '';
        setMsg(els.aiStatus, 'AI 请求失败：' + String(e.message || e), 'err');
      });
    });
  }

  els.btnAiCopy.addEventListener('click', function () {
    var val = els.aiResult.value;
    if (!val) { setMsg(els.aiStatus, '暂无可复制的结果。', 'err'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(function () {
        setMsg(els.aiStatus, '已复制到剪贴板。', 'ok');
      }).catch(function () { setMsg(els.aiStatus, '复制失败，请手动选择复制。', 'err'); });
    } else {
      els.aiResult.select();
      try { document.execCommand('copy'); setMsg(els.aiStatus, '已复制到剪贴板。', 'ok'); }
      catch (e) { setMsg(els.aiStatus, '复制失败，请手动选择复制。', 'err'); }
    }
  });

})();
