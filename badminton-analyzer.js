import { DrawingUtils, FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm";

const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};

const JOINTS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

const state = {
  vision: null,
  poseLandmarker: null,
  modelType: "full",
  poseConfigKey: "",
  analysis: null,
  videoUrl: "",
  videoFile: null,
  videoSource: null,
  overlayFrame: null,
  isAnalyzing: false,
  loopHandle: 0,
};

const els = {
  analyzeButton: document.getElementById("analyze-button"),
  balanceReading: document.getElementById("balance-reading"),
  confidenceThreshold: document.getElementById("confidence-threshold"),
  confidenceValue: document.getElementById("confidence-value"),
  coverageNote: document.getElementById("coverage-note"),
  coverageValue: document.getElementById("coverage-value"),
  cursorTime: document.getElementById("cursor-time"),
  detectedCount: document.getElementById("detected-count"),
  dominantHand: document.getElementById("dominant-hand"),
  eventCount: document.getElementById("event-count"),
  eventList: document.getElementById("event-list"),
  exportButton: document.getElementById("export-button"),
  frameCount: document.getElementById("frame-count"),
  insightList: document.getElementById("insight-list"),
  kneeReading: document.getElementById("knee-reading"),
  lungeNote: document.getElementById("lunge-note"),
  lungeValue: document.getElementById("lunge-value"),
  modelType: document.getElementById("model-type"),
  movementReading: document.getElementById("movement-reading"),
  readyNote: document.getElementById("ready-note"),
  readyValue: document.getElementById("ready-value"),
  reachReading: document.getElementById("reach-reading"),
  resetButton: document.getElementById("reset-button"),
  rotationReading: document.getElementById("rotation-reading"),
  sampleRate: document.getElementById("sample-rate"),
  speedNote: document.getElementById("speed-note"),
  speedValue: document.getElementById("speed-value"),
  skeletonCanvas: document.getElementById("skeleton-canvas"),
  skeletonEmpty: document.getElementById("skeleton-empty"),
  stageEmpty: document.getElementById("stage-empty"),
  stanceReading: document.getElementById("stance-reading"),
  statusBadge: document.getElementById("status-badge"),
  statusText: document.getElementById("status-text"),
  timelineCanvas: document.getElementById("timeline-canvas"),
  timelineCaption: document.getElementById("timeline-caption"),
  video: document.getElementById("analysis-video"),
  videoDuration: document.getElementById("video-duration"),
  videoInput: document.getElementById("video-input"),
  videoUrl: document.getElementById("video-url"),
  loadUrlButton: document.getElementById("load-url-button"),
};

const skeletonCtx = els.skeletonCanvas.getContext("2d");
const timelineCtx = els.timelineCanvas.getContext("2d");
const drawingUtils = new DrawingUtils(skeletonCtx);

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleAt(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const abz = (a.z || 0) - (b.z || 0);
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = (c.z || 0) - (b.z || 0);
  const dot = abx * cbx + aby * cby + abz * cbz;
  const magA = Math.hypot(abx, aby, abz);
  const magC = Math.hypot(cbx, cby, cbz);
  if (!magA || !magC) return null;
  const ratio = clamp(dot / (magA * magC), -1, 1);
  return (Math.acos(ratio) * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentile(values, ratio) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const index = clamp(Math.floor((valid.length - 1) * ratio), 0, valid.length - 1);
  return valid[index];
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  const whole = Math.floor(seconds);
  const minutes = String(Math.floor(whole / 60)).padStart(2, "0");
  const secs = String(whole % 60).padStart(2, "0");
  const decimals = String(Math.floor((seconds - whole) * 100)).padStart(2, "0");
  return `${minutes}:${secs}.${decimals}`;
}

function setStatus(stateName, text) {
  els.statusBadge.dataset.state = stateName;
  const labels = {
    idle: "待機中",
    loading: "初期化中",
    running: "解析中",
    ready: "解析完了",
    error: "要確認",
  };
  els.statusBadge.textContent = labels[stateName] || "待機中";
  els.statusText.textContent = text;
}

function resetSummary() {
  els.coverageValue.textContent = "--";
  els.readyValue.textContent = "--";
  els.speedValue.textContent = "--";
  els.lungeValue.textContent = "--";
  els.coverageNote.textContent = "全身が入るほど安定します。";
  els.readyNote.textContent = "準備姿勢に入れた時間割合です。";
  els.speedNote.textContent = "肩幅で正規化した相対速度です。";
  els.lungeNote.textContent = "深いランジ判定の回数です。";
  els.frameCount.textContent = "--";
  els.detectedCount.textContent = "--";
  els.eventCount.textContent = "--";
  els.cursorTime.textContent = "00:00.00";
  els.stanceReading.textContent = "--";
  els.kneeReading.textContent = "--";
  els.balanceReading.textContent = "--";
  els.reachReading.textContent = "--";
  els.rotationReading.textContent = "--";
  els.movementReading.textContent = "--";
  els.eventList.innerHTML = "<li>解析後にイベントを表示します。</li>";
  els.insightList.innerHTML = "<li>動画を解析すると所見を生成します。</li>";
  els.timelineCaption.textContent = "解析後にスタンス幅と膝の沈み込みを表示します。";
  drawTimeline();
}

function releaseVideoUrl() {
  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = "";
  }
}

function resetAnalysis(keepVideo = true) {
  state.analysis = null;
  state.overlayFrame = null;
  els.exportButton.disabled = true;
  resetSummary();
  if (!keepVideo) {
    releaseVideoUrl();
    state.videoFile = null;
    state.videoSource = null;
    els.video.removeAttribute("src");
    els.video.load();
    els.videoInput.value = "";
    els.videoUrl.value = "";
    els.stageEmpty.hidden = false;
    els.videoDuration.textContent = "--";
  }
  drawSkeletonView();
}

function updateConfidenceLabel() {
  els.confidenceValue.textContent = Number(els.confidenceThreshold.value).toFixed(2);
}

function setActionEnabled(enabled) {
  els.analyzeButton.disabled = !enabled;
  els.resetButton.disabled = state.isAnalyzing;
  els.videoInput.disabled = state.isAnalyzing;
  els.videoUrl.disabled = state.isAnalyzing;
  els.loadUrlButton.disabled = state.isAnalyzing;
  els.dominantHand.disabled = state.isAnalyzing;
  els.modelType.disabled = state.isAnalyzing;
  els.sampleRate.disabled = state.isAnalyzing;
  els.confidenceThreshold.disabled = state.isAnalyzing;
}

async function ensureLandmarker() {
  const requestedModel = els.modelType.value;
  const confidence = Number(els.confidenceThreshold.value);
  const poseConfigKey = `${requestedModel}:${confidence.toFixed(2)}`;

  if (!state.vision) {
    setStatus("loading", "MediaPipe Pose Landmarker を初期化しています。");
    state.vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
    );
  }

  if (state.poseLandmarker && state.poseConfigKey === poseConfigKey) {
    return state.poseLandmarker;
  }

  if (state.poseLandmarker && typeof state.poseLandmarker.close === "function") {
    state.poseLandmarker.close();
  }

  async function createPoseLandmarker(delegate) {
    const options = {
      baseOptions: {
        modelAssetPath: MODEL_URLS[requestedModel],
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: confidence,
      minPosePresenceConfidence: confidence,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };

    if (delegate) {
      options.baseOptions.delegate = delegate;
    }

    return PoseLandmarker.createFromOptions(state.vision, options);
  }

  try {
    state.poseLandmarker = await createPoseLandmarker("GPU");
  } catch (error) {
    state.poseLandmarker = await createPoseLandmarker();
  }

  state.modelType = requestedModel;
  state.poseConfigKey = poseConfigKey;
  return state.poseLandmarker;
}

function ensureSkeletonCanvasSize() {
  const width = Math.max(1, Math.round(els.skeletonCanvas.clientWidth));
  const height = Math.max(1, Math.round(els.skeletonCanvas.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (els.skeletonCanvas.width !== targetWidth || els.skeletonCanvas.height !== targetHeight) {
    els.skeletonCanvas.width = targetWidth;
    els.skeletonCanvas.height = targetHeight;
    skeletonCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function ensureTimelineCanvasSize() {
  const width = Math.max(1, Math.round(els.timelineCanvas.clientWidth));
  const height = Math.max(1, Math.round(els.timelineCanvas.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (els.timelineCanvas.width !== targetWidth || els.timelineCanvas.height !== targetHeight) {
    els.timelineCanvas.width = targetWidth;
    els.timelineCanvas.height = targetHeight;
    timelineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function pointOnCanvas(point, width, height) {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

function projectLandmarksToSkeleton(landmarks, width, height) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.16);
  const spanY = Math.max(maxY - minY, 0.4);
  const paddingX = width * 0.18;
  const paddingY = height * 0.12;
  const scale = Math.min((width - paddingX * 2) / spanX, (height - paddingY * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;

  function mapPoint(point) {
    return {
      ...point,
      x: (point.x * scale + offsetX) / width,
      y: (point.y * scale + offsetY) / height,
    };
  }

  return {
    landmarks: landmarks.map(mapPoint),
    mapPoint,
  };
}

function drawGuideLine(a, b, color, lineWidth, dashed = false) {
  const width = els.skeletonCanvas.clientWidth;
  const height = els.skeletonCanvas.clientHeight;
  const start = pointOnCanvas(a, width, height);
  const end = pointOnCanvas(b, width, height);
  skeletonCtx.save();
  skeletonCtx.strokeStyle = color;
  skeletonCtx.lineWidth = lineWidth;
  skeletonCtx.setLineDash(dashed ? [8, 6] : []);
  skeletonCtx.beginPath();
  skeletonCtx.moveTo(start.x, start.y);
  skeletonCtx.lineTo(end.x, end.y);
  skeletonCtx.stroke();
  skeletonCtx.restore();
}

function drawSkeletonView() {
  ensureSkeletonCanvasSize();
  const width = els.skeletonCanvas.clientWidth;
  const height = els.skeletonCanvas.clientHeight;
  skeletonCtx.clearRect(0, 0, width, height);

  if (!state.overlayFrame || !state.overlayFrame.detected) {
    els.skeletonEmpty.hidden = false;
    return;
  }

  els.skeletonEmpty.hidden = true;
  const frame = state.overlayFrame;
  const projected = projectLandmarksToSkeleton(frame.landmarks, width, height);
  const skeletonLandmarks = projected.landmarks;
  const leftAnkle = projected.mapPoint(frame.leftAnkle);
  const rightAnkle = projected.mapPoint(frame.rightAnkle);
  const leftShoulder = projected.mapPoint(frame.leftShoulder);
  const rightShoulder = projected.mapPoint(frame.rightShoulder);
  const shoulderMid = projected.mapPoint(frame.shoulderMid);
  const hipMid = projected.mapPoint(frame.hipMid);
  const highlight = [
    projected.mapPoint(frame.dominantShoulder),
    projected.mapPoint(frame.dominantElbow),
    projected.mapPoint(frame.dominantWrist),
  ];

  drawGuideLine(leftAnkle, rightAnkle, "rgba(239, 196, 84, 0.8)", 3, true);
  drawGuideLine(leftShoulder, rightShoulder, "rgba(13, 127, 130, 0.8)", 3, false);
  drawGuideLine(shoulderMid, hipMid, "rgba(255, 255, 255, 0.8)", 2, true);

  drawingUtils.drawConnectors(skeletonLandmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "rgba(255, 245, 234, 0.88)",
    lineWidth: 3,
  });

  drawingUtils.drawLandmarks(skeletonLandmarks, {
    color: "#0d7f82",
    radius: 3.2,
    fillColor: "#f7eedb",
    lineWidth: 1.4,
  });

  skeletonCtx.save();
  skeletonCtx.fillStyle = "#c65c23";
  for (const point of highlight) {
    const mapped = pointOnCanvas(point, width, height);
    skeletonCtx.beginPath();
    skeletonCtx.arc(mapped.x, mapped.y, 5.5, 0, Math.PI * 2);
    skeletonCtx.fill();
  }
  skeletonCtx.restore();
}

function findNearestFrame(time) {
  if (!state.analysis?.frames?.length) return null;
  const frames = state.analysis.frames;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (low === 0) return frames[0];
  const prev = frames[low - 1];
  const next = frames[low];
  return Math.abs(prev.time - time) <= Math.abs(next.time - time) ? prev : next;
}

function stanceLabel(ratio) {
  if (!Number.isFinite(ratio)) return "--";
  if (ratio < 1.05) return "狭い";
  if (ratio < 1.7) return "標準";
  return "広い";
}

function reachLabel(frame) {
  if (!frame.detected) return "--";
  if (frame.wristAboveHead) return "高い打点";
  if (frame.wristAboveShoulder) return "肩上に準備";
  return "低め";
}

function balanceLabel(frame) {
  if (!frame.detected) return "--";
  if (frame.shoulderTiltDeg < 7 && frame.headBetweenFeet) return "安定";
  if (frame.shoulderTiltDeg < 13) return "やや傾き";
  return "崩れ気味";
}

function movementLabel(speed) {
  if (!Number.isFinite(speed)) return "--";
  if (speed < 0.45) return "静止";
  if (speed < 0.95) return "移動";
  return "大きい";
}

function updateCurrentFrameReadings() {
  const time = Number.isFinite(els.video.currentTime) ? els.video.currentTime : 0;
  els.cursorTime.textContent = formatTime(time);

  if (!state.analysis?.frames?.length) {
    state.overlayFrame = null;
    drawSkeletonView();
    return;
  }

  const frame = findNearestFrame(time);
  state.overlayFrame = frame;
  if (!frame?.detected) {
    els.stanceReading.textContent = "未検出";
    els.kneeReading.textContent = "未検出";
    els.balanceReading.textContent = "未検出";
    els.reachReading.textContent = "未検出";
    els.rotationReading.textContent = "未検出";
    els.movementReading.textContent = "未検出";
    drawSkeletonView();
    drawTimeline();
    return;
  }

  els.stanceReading.textContent = `${stanceLabel(frame.stanceWidthRatio)} / ${frame.stanceWidthRatio.toFixed(2)}x`;
  els.kneeReading.textContent = `${Math.round(frame.avgKneeAngle)}deg`;
  els.balanceReading.textContent = `${balanceLabel(frame)} / tilt ${Math.round(frame.shoulderTiltDeg)}deg`;
  els.reachReading.textContent = `${reachLabel(frame)} / arm ${Math.round(frame.armAngle)}deg`;
  els.rotationReading.textContent = `${Math.round(frame.torsoRotationDeg)}deg`;
  els.movementReading.textContent = `${movementLabel(frame.hipSpeed)} / ${frame.hipSpeed?.toFixed(2) ?? "--"}`;

  drawSkeletonView();
  drawTimeline();
}

function extractPoseMetrics(result, time, dominantHand) {
  const landmarks = result.landmarks?.[0];
  const worldLandmarks = result.worldLandmarks?.[0];
  if (!landmarks || landmarks.length < 29) {
    return {
      time,
      detected: false,
    };
  }

  const leftShoulder = landmarks[JOINTS.leftShoulder];
  const rightShoulder = landmarks[JOINTS.rightShoulder];
  const leftElbow = landmarks[JOINTS.leftElbow];
  const rightElbow = landmarks[JOINTS.rightElbow];
  const leftWrist = landmarks[JOINTS.leftWrist];
  const rightWrist = landmarks[JOINTS.rightWrist];
  const leftHip = landmarks[JOINTS.leftHip];
  const rightHip = landmarks[JOINTS.rightHip];
  const leftKnee = landmarks[JOINTS.leftKnee];
  const rightKnee = landmarks[JOINTS.rightKnee];
  const leftAnkle = landmarks[JOINTS.leftAnkle];
  const rightAnkle = landmarks[JOINTS.rightAnkle];
  const nose = landmarks[JOINTS.nose];

  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  const ankleMid = midpoint(leftAnkle, rightAnkle);
  const shoulderWidth = distance2d(leftShoulder, rightShoulder) || 0.0001;
  const stanceWidthRatio = distance2d(leftAnkle, rightAnkle) / shoulderWidth;
  const leftKneeAngle = angleAt(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = angleAt(rightHip, rightKnee, rightAnkle);
  const avgKneeAngle = average([leftKneeAngle, rightKneeAngle]);
  const shoulderTiltDeg = Math.abs(
    (Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x) * 180) / Math.PI
  );
  const torsoSideLeanDeg = Math.abs(
    (Math.atan2(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) * 180) / Math.PI
  );
  const hipHeightRatio = (ankleMid.y - hipMid.y) / shoulderWidth;
  const headBetweenFeet = nose.x >= Math.min(leftAnkle.x, rightAnkle.x) && nose.x <= Math.max(leftAnkle.x, rightAnkle.x);
  const dominantSide = dominantHand === "left" ? "left" : "right";
  const dominantShoulder = dominantSide === "left" ? leftShoulder : rightShoulder;
  const dominantElbow = dominantSide === "left" ? leftElbow : rightElbow;
  const dominantWrist = dominantSide === "left" ? leftWrist : rightWrist;
  const dominantHip = dominantSide === "left" ? leftHip : rightHip;
  const armAngle = angleAt(dominantShoulder, dominantElbow, dominantWrist);
  const wristAboveShoulder = dominantWrist.y < dominantShoulder.y;
  const wristAboveHead = dominantWrist.y < nose.y;
  const wristReachRatio = (dominantShoulder.y - dominantWrist.y) / shoulderWidth;
  const visibility = average([
    nose.visibility,
    leftShoulder.visibility,
    rightShoulder.visibility,
    dominantWrist.visibility,
    leftHip.visibility,
    rightHip.visibility,
    leftAnkle.visibility,
    rightAnkle.visibility,
  ]) || 0;

  let torsoRotationDeg = 0;
  if (worldLandmarks?.[JOINTS.leftShoulder] && worldLandmarks?.[JOINTS.rightShoulder]) {
    const leftWorldShoulder = worldLandmarks[JOINTS.leftShoulder];
    const rightWorldShoulder = worldLandmarks[JOINTS.rightShoulder];
    const leftWorldHip = worldLandmarks[JOINTS.leftHip];
    const rightWorldHip = worldLandmarks[JOINTS.rightHip];
    const shoulderRotation = Math.atan2(
      Math.abs(rightWorldShoulder.z - leftWorldShoulder.z),
      Math.abs(rightWorldShoulder.x - leftWorldShoulder.x) + 0.0001
    );
    const hipRotation = Math.atan2(
      Math.abs(rightWorldHip.z - leftWorldHip.z),
      Math.abs(rightWorldHip.x - leftWorldHip.x) + 0.0001
    );
    torsoRotationDeg = ((shoulderRotation + hipRotation) * 90) / Math.PI;
  }

  return {
    time,
    detected: visibility > 0.35,
    landmarks,
    worldLandmarks,
    leftShoulder,
    rightShoulder,
    leftAnkle,
    rightAnkle,
    shoulderMid,
    hipMid,
    dominantShoulder,
    dominantElbow,
    dominantWrist,
    dominantHip,
    visibility,
    shoulderWidth,
    stanceWidthRatio,
    leftKneeAngle,
    rightKneeAngle,
    avgKneeAngle,
    shoulderTiltDeg,
    torsoSideLeanDeg,
    torsoRotationDeg,
    hipHeightRatio,
    armAngle,
    wristReachRatio,
    wristAboveShoulder,
    wristAboveHead,
    headBetweenFeet,
    readyStance: false,
    deepLunge: false,
    defensiveCrouch: false,
    overheadReach: false,
    hipSpeed: 0,
    wristSpeed: 0,
    pathStep: 0,
  };
}

function enrichFrames(frames) {
  let previousDetected = null;

  for (const frame of frames) {
    if (!frame.detected) continue;

    if (previousDetected) {
      const dt = Math.max(frame.time - previousDetected.time, 1 / 120);
      frame.pathStep = distance2d(frame.hipMid, previousDetected.hipMid) / frame.shoulderWidth;
      frame.hipSpeed = frame.pathStep / dt;
      frame.wristSpeed = distance2d(frame.dominantWrist, previousDetected.dominantWrist) / frame.shoulderWidth / dt;
    }

    const minKnee = Math.min(frame.leftKneeAngle || 180, frame.rightKneeAngle || 180);
    frame.readyStance =
      frame.stanceWidthRatio >= 1.1 &&
      frame.stanceWidthRatio <= 1.75 &&
      frame.avgKneeAngle >= 115 &&
      frame.avgKneeAngle <= 150 &&
      frame.shoulderTiltDeg <= 12 &&
      frame.headBetweenFeet;
    frame.deepLunge = frame.stanceWidthRatio >= 1.75 && minKnee <= 125;
    frame.defensiveCrouch = frame.avgKneeAngle <= 128 && frame.hipHeightRatio <= 1.9;
    frame.overheadReach = frame.wristAboveHead && frame.armAngle >= 110;

    previousDetected = frame;
  }

  return frames;
}

function buildEvents(frames) {
  const events = [];
  let lungeActive = false;
  let overheadActive = false;
  let crouchActive = false;
  let burstActive = false;

  for (const frame of frames) {
    if (!frame.detected) continue;

    if (frame.deepLunge && !lungeActive) {
      events.push({
        type: "lunge",
        time: frame.time,
        label: "深い踏み込み",
        detail: `stance ${frame.stanceWidthRatio.toFixed(2)}x / knee ${Math.round(frame.avgKneeAngle)}deg`,
      });
    }
    lungeActive = frame.deepLunge;

    if (frame.overheadReach && !overheadActive) {
      events.push({
        type: "overhead",
        time: frame.time,
        label: "高い打点準備",
        detail: `arm ${Math.round(frame.armAngle)}deg / reach ${frame.wristReachRatio.toFixed(2)}`,
      });
    }
    overheadActive = frame.overheadReach;

    if (frame.defensiveCrouch && !crouchActive) {
      events.push({
        type: "crouch",
        time: frame.time,
        label: "低い守備姿勢",
        detail: `knee ${Math.round(frame.avgKneeAngle)}deg / hip ${frame.hipHeightRatio.toFixed(2)}`,
      });
    }
    crouchActive = frame.defensiveCrouch;

    const burst = frame.hipSpeed >= 0.95;
    if (burst && !burstActive) {
      events.push({
        type: "burst",
        time: frame.time,
        label: "大きい移動",
        detail: `speed ${frame.hipSpeed.toFixed(2)}`,
      });
    }
    burstActive = burst;
  }

  return events;
}

function buildInsights(frames, events) {
  const detectedFrames = frames.filter((frame) => frame.detected);
  if (!detectedFrames.length) {
    return ["全身が映る角度と明るさにすると、解析の安定性が上がります。"];
  }

  const readyRatio = detectedFrames.filter((frame) => frame.readyStance).length / detectedFrames.length;
  const avgKnee = average(detectedFrames.map((frame) => frame.avgKneeAngle)) || 0;
  const avgTilt = average(detectedFrames.map((frame) => frame.shoulderTiltDeg)) || 0;
  const maxReach = percentile(detectedFrames.map((frame) => frame.wristReachRatio), 0.85) || 0;
  const maxBurst = percentile(detectedFrames.map((frame) => frame.hipSpeed), 0.9) || 0;
  const lungeCount = events.filter((event) => event.type === "lunge").length;
  const notes = [];

  if (readyRatio < 0.25) {
    notes.push("構えの再現率が低めです。スプリット後に足幅を肩幅の1.1倍以上で止める意識を入れると比較しやすくなります。");
  } else if (readyRatio > 0.45) {
    notes.push("準備姿勢に戻れている時間が長く、次動作への移行は安定しています。");
  }

  if (avgKnee > 148) {
    notes.push("膝の曲がりが浅めです。股関節と膝を一緒に沈めると、前後左右への初動を作りやすくなります。");
  } else if (avgKnee < 118) {
    notes.push("全体に低く入れています。長いラリーでは沈み込みすぎで戻りが遅れないかも見ておくと良さそうです。");
  }

  if (avgTilt > 14) {
    notes.push("肩の傾きが大きい場面があります。打球直前に頭が足の間に残るかを比較すると、バランス改善の手掛かりになります。");
  }

  if (maxReach < 0.08) {
    notes.push("利き腕の打点が低めです。肩より十分上まで肘と手首が伸びる瞬間を作れると、上から押し込むショットを評価しやすくなります。");
  } else {
    notes.push("高い打点を作れている場面があります。そこに入る前の足運びを切り出して比較すると再現性を見やすいです。");
  }

  if (lungeCount === 0) {
    notes.push("深い踏み込み判定は出ませんでした。前後動を評価したい場合は、コート全身が入る横寄りの画角が向いています。");
  } else if (lungeCount >= 3) {
    notes.push("踏み込み場面が複数回取れています。前脚膝角度と復帰速度を並べると、戻りの強さを見比べられます。");
  }

  if (maxBurst > 1.2) {
    notes.push("重心移動のピークが大きく、フットワークの強弱がはっきりしています。減速後の姿勢維持もセットで確認すると実戦的です。");
  }

  return notes.slice(0, 5);
}

function summarizeAnalysis(frames, duration) {
  const detectedFrames = frames.filter((frame) => frame.detected);
  const events = buildEvents(frames);
  const readyFrames = detectedFrames.filter((frame) => frame.readyStance);
  const coverage = frames.length ? detectedFrames.length / frames.length : 0;
  const readyRatio = detectedFrames.length ? readyFrames.length / detectedFrames.length : 0;
  const maxWristSpeed = percentile(detectedFrames.map((frame) => frame.wristSpeed), 0.9) || 0;
  const lungeCount = events.filter((event) => event.type === "lunge").length;
  const movementLoad = detectedFrames.reduce((sum, frame) => sum + (frame.pathStep || 0), 0);
  const avgKneeAngle = average(detectedFrames.map((frame) => frame.avgKneeAngle)) || 0;
  const avgTilt = average(detectedFrames.map((frame) => frame.shoulderTiltDeg)) || 0;
  const maxStance = percentile(detectedFrames.map((frame) => frame.stanceWidthRatio), 0.92) || 0;
  const insights = buildInsights(frames, events);

  return {
    duration,
    frames,
    detectedFrames,
    events,
    insights,
    summary: {
      coverage,
      readyRatio,
      maxWristSpeed,
      lungeCount,
      movementLoad,
      avgKneeAngle,
      avgTilt,
      maxStance,
    },
  };
}

function renderEvents(events) {
  if (!events.length) {
    els.eventList.innerHTML = "<li>目立つイベントは検出されませんでした。</li>";
    return;
  }

  els.eventList.innerHTML = events
    .slice(0, 12)
    .map(
      (event) =>
        `<li><strong>${formatTime(event.time)}</strong>${event.label}<br><span class="muted">${event.detail}</span></li>`
    )
    .join("");
}

function renderInsights(insights) {
  els.insightList.innerHTML = insights.map((text) => `<li>${text}</li>`).join("");
}

function renderSummary(analysis) {
  const { summary, events, detectedFrames, frames } = analysis;
  els.coverageValue.textContent = `${Math.round(summary.coverage * 100)}%`;
  els.readyValue.textContent = `${Math.round(summary.readyRatio * 100)}%`;
  els.speedValue.textContent = summary.maxWristSpeed ? summary.maxWristSpeed.toFixed(2) : "0.00";
  els.lungeValue.textContent = String(summary.lungeCount);
  els.coverageNote.textContent = `${detectedFrames.length} / ${frames.length} フレームで骨格を取得しました。`;
  els.readyNote.textContent = `平均膝角度 ${Math.round(summary.avgKneeAngle)}deg / 最大スタンス ${summary.maxStance.toFixed(2)}x`;
  els.speedNote.textContent = `肩幅基準の90パーセンタイル速度です。`;
  els.lungeNote.textContent = `重心移動量 ${summary.movementLoad.toFixed(2)} shoulder-width`;
  els.frameCount.textContent = String(frames.length);
  els.detectedCount.textContent = `${detectedFrames.length}`;
  els.eventCount.textContent = String(events.length);
  els.timelineCaption.textContent = `duration ${formatTime(analysis.duration)} / click で再生位置を移動できます。`;
  renderEvents(events);
  renderInsights(analysis.insights);
  els.exportButton.disabled = false;
}

function drawTimeline() {
  ensureTimelineCanvasSize();
  const width = els.timelineCanvas.clientWidth;
  const height = els.timelineCanvas.clientHeight;
  timelineCtx.clearRect(0, 0, width, height);

  const inset = { top: 18, right: 14, bottom: 22, left: 14 };
  const innerWidth = width - inset.left - inset.right;
  const innerHeight = height - inset.top - inset.bottom;

  timelineCtx.save();
  timelineCtx.strokeStyle = "rgba(24, 33, 29, 0.08)";
  timelineCtx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = inset.top + (innerHeight / 3) * i;
    timelineCtx.beginPath();
    timelineCtx.moveTo(inset.left, y);
    timelineCtx.lineTo(width - inset.right, y);
    timelineCtx.stroke();
  }
  timelineCtx.restore();

  if (!state.analysis?.frames?.length) {
    timelineCtx.save();
    timelineCtx.fillStyle = "rgba(24, 33, 29, 0.42)";
    timelineCtx.font = '14px "Aptos", "Yu Gothic UI", sans-serif';
    timelineCtx.fillText("解析後にトレースを描画します。", inset.left, inset.top + 22);
    timelineCtx.restore();
    return;
  }

  const frames = state.analysis.frames;
  const duration = state.analysis.duration || frames.at(-1)?.time || 1;

  const series = [
    {
      color: "#c65c23",
      values: frames.map((frame) =>
        frame.detected ? clamp((frame.stanceWidthRatio - 0.8) / 1.6, 0, 1) : null
      ),
    },
    {
      color: "#0d7f82",
      values: frames.map((frame) =>
        frame.detected ? clamp((180 - frame.avgKneeAngle) / 70, 0, 1) : null
      ),
    },
  ];

  for (const line of series) {
    timelineCtx.save();
    timelineCtx.strokeStyle = line.color;
    timelineCtx.lineWidth = 2.5;
    timelineCtx.beginPath();
    let started = false;
    frames.forEach((frame, index) => {
      const value = line.values[index];
      if (value == null) {
        started = false;
        return;
      }
      const x = inset.left + (frame.time / duration) * innerWidth;
      const y = inset.top + (1 - value) * innerHeight;
      if (!started) {
        timelineCtx.moveTo(x, y);
        started = true;
      } else {
        timelineCtx.lineTo(x, y);
      }
    });
    timelineCtx.stroke();
    timelineCtx.restore();
  }

  timelineCtx.save();
  timelineCtx.fillStyle = "rgba(24, 33, 29, 0.22)";
  for (const event of state.analysis.events) {
    const x = inset.left + (event.time / duration) * innerWidth;
    timelineCtx.fillRect(x - 1, inset.top, 2, innerHeight);
  }
  timelineCtx.restore();

  const cursorTime = clamp(els.video.currentTime || 0, 0, duration);
  const cursorX = inset.left + (cursorTime / duration) * innerWidth;
  timelineCtx.save();
  timelineCtx.strokeStyle = "#18211d";
  timelineCtx.lineWidth = 2;
  timelineCtx.beginPath();
  timelineCtx.moveTo(cursorX, inset.top);
  timelineCtx.lineTo(cursorX, inset.top + innerHeight);
  timelineCtx.stroke();
  timelineCtx.restore();
}

async function seekVideo(time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("seek failed"));
    };
    const cleanup = () => {
      els.video.removeEventListener("seeked", onSeeked);
      els.video.removeEventListener("error", onError);
    };

    els.video.addEventListener("seeked", onSeeked, { once: true });
    els.video.addEventListener("error", onError, { once: true });
    els.video.currentTime = clamp(time, 0, Math.max(0, els.video.duration - 0.001));
  });
}

function updateProgress(done, total) {
  const ratio = total ? done / total : 0;
  setStatus("running", `フレーム解析 ${done} / ${total} (${Math.round(ratio * 100)}%)`);
}

async function analyzeVideo() {
  if (!els.video.src || !Number.isFinite(els.video.duration) || els.video.duration <= 0) {
    setStatus("error", "先に動画ファイルまたは動画URLを読み込んでください。");
    return;
  }

  state.isAnalyzing = true;
  setActionEnabled(false);
  resetAnalysis(true);
  setStatus("loading", "モデルを準備しています。");

  try {
    const poseLandmarker = await ensureLandmarker();
    const originalTime = els.video.currentTime || 0;
    els.video.pause();
    const sampleRate = Number(els.sampleRate.value);
    const step = 1 / sampleRate;
    const duration = els.video.duration;
    const times = [];
    for (let time = 0; time < duration; time += step) {
      times.push(Number(time.toFixed(4)));
    }
    if (!times.length || times.at(-1) !== duration) {
      times.push(duration);
    }

    const frames = [];
    updateProgress(0, times.length);
    for (let index = 0; index < times.length; index++) {
      const time = times[index];
      await seekVideo(time);
      const result = poseLandmarker.detectForVideo(els.video, Math.round(time * 1000));
      frames.push(extractPoseMetrics(result, time, els.dominantHand.value));
      if (index === 0 || index === times.length - 1 || index % 8 === 0) {
        updateProgress(index + 1, times.length);
      }
    }

    enrichFrames(frames);
    state.analysis = summarizeAnalysis(frames, duration);
    await seekVideo(originalTime);
    renderSummary(state.analysis);
    updateCurrentFrameReadings();
    setStatus("ready", "解析が完了しました。タイムラインをクリックするとフレームを見返せます。");
  } catch (error) {
    resetAnalysis(true);
    setStatus("error", "解析に失敗しました。ブラウザのネット接続と対応状況を確認してください。");
  } finally {
    state.isAnalyzing = false;
    setActionEnabled(true);
  }
}

function exportAnalysis() {
  if (!state.analysis) return;

  const payload = {
    exportedAt: new Date().toISOString(),
    video: {
      name: state.videoSource?.name || state.videoFile?.name || "unknown",
      sourceType: state.videoSource?.type || (state.videoFile ? "file" : "unknown"),
      sourceUrl: state.videoSource?.url || null,
      duration: state.analysis.duration,
      dominantHand: els.dominantHand.value,
      modelType: els.modelType.value,
      sampleRate: Number(els.sampleRate.value),
      confidenceThreshold: Number(els.confidenceThreshold.value),
    },
    summary: state.analysis.summary,
    events: state.analysis.events,
    insights: state.analysis.insights,
    frames: state.analysis.frames.map((frame) => ({
      time: frame.time,
      detected: frame.detected,
      visibility: frame.visibility || 0,
      stanceWidthRatio: frame.stanceWidthRatio || null,
      avgKneeAngle: frame.avgKneeAngle || null,
      shoulderTiltDeg: frame.shoulderTiltDeg || null,
      torsoRotationDeg: frame.torsoRotationDeg || null,
      wristReachRatio: frame.wristReachRatio || null,
      wristSpeed: frame.wristSpeed || null,
      hipSpeed: frame.hipSpeed || null,
      readyStance: frame.readyStance || false,
      deepLunge: frame.deepLunge || false,
      defensiveCrouch: frame.defensiveCrouch || false,
      overheadReach: frame.overheadReach || false,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const baseName = (state.videoSource?.name || state.videoFile?.name || "badminton-session").replace(/\.[^.]+$/, "");
  anchor.download = `${baseName}-analysis.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeVideoUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("empty");
  }

  const normalized = new URL(trimmed, window.location.href);
  if (!["http:", "https:"].includes(normalized.protocol)) {
    throw new Error("scheme");
  }

  return normalized.toString();
}

function loadVideoSource({ src, name, type, url }) {
  resetAnalysis(true);
  releaseVideoUrl();
  state.videoFile = null;
  state.videoSource = {
    name,
    type,
    url: url || null,
  };
  els.video.src = src;
  els.stageEmpty.hidden = true;
  els.video.load();
}

function loadVideoFile(file) {
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  els.videoUrl.value = "";
  loadVideoSource({
    src: objectUrl,
    name: file.name,
    type: "file",
    url: null,
  });
  state.videoFile = file;
  state.videoUrl = objectUrl;
  setStatus("idle", "動画を読み込みました。解析スタートで骨格推定を走らせます。");
}

function loadVideoFromUrl() {
  try {
    const normalizedUrl = normalizeVideoUrl(els.videoUrl.value);
    const url = new URL(normalizedUrl);
    const lastPath = url.pathname.split("/").filter(Boolean).at(-1);
    els.videoInput.value = "";
    loadVideoSource({
      src: normalizedUrl,
      name: lastPath || url.hostname,
      type: "url",
      url: normalizedUrl,
    });
    setStatus("idle", "動画URLを読み込みました。外部サーバーが CORS を許可していれば解析できます。");
  } catch (error) {
    if (error.message === "scheme") {
      setStatus("error", "http または https の動画URLを指定してください。");
      return;
    }
    setStatus("error", "動画URLの形式を確認してください。");
  }
}

function drawLoop() {
  updateCurrentFrameReadings();
  state.loopHandle = window.requestAnimationFrame(drawLoop);
}

function handleTimelineClick(event) {
  if (!state.analysis?.duration) return;
  const rect = els.timelineCanvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  els.video.currentTime = ratio * state.analysis.duration;
}

function bindEvents() {
  els.videoInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      loadVideoFile(file);
    }
  });

  els.loadUrlButton.addEventListener("click", loadVideoFromUrl);
  els.videoUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadVideoFromUrl();
    }
  });

  els.video.addEventListener("loadedmetadata", () => {
    els.videoDuration.textContent = formatTime(els.video.duration);
    ensureSkeletonCanvasSize();
    drawSkeletonView();
  });

  els.video.addEventListener("error", () => {
    resetAnalysis(true);
    els.stageEmpty.hidden = false;
    setStatus("error", "動画の読み込みに失敗しました。URLの直リンク性と CORS 設定を確認してください。");
  });

  els.video.addEventListener("resize", () => {
    ensureSkeletonCanvasSize();
    drawSkeletonView();
  });

  els.video.addEventListener("emptied", () => {
    drawSkeletonView();
  });

  els.video.addEventListener("seeking", () => {
    updateCurrentFrameReadings();
  });

  els.video.addEventListener("timeupdate", () => {
    updateCurrentFrameReadings();
  });

  els.video.addEventListener("pause", () => {
    updateCurrentFrameReadings();
  });

  els.video.addEventListener("play", () => {
    updateCurrentFrameReadings();
  });

  els.analyzeButton.addEventListener("click", analyzeVideo);
  els.exportButton.addEventListener("click", exportAnalysis);
  els.resetButton.addEventListener("click", () => {
    resetAnalysis(false);
    setStatus("idle", "動画をリセットしました。");
  });
  els.confidenceThreshold.addEventListener("input", updateConfidenceLabel);
  els.modelType.addEventListener("change", () => {
    if (state.analysis) {
      setStatus("idle", "モデルを変更しました。再解析で反映されます。");
    }
  });
  els.timelineCanvas.addEventListener("click", handleTimelineClick);
  window.addEventListener("resize", () => {
    ensureSkeletonCanvasSize();
    ensureTimelineCanvasSize();
    drawSkeletonView();
    drawTimeline();
  });
}

function init() {
  updateConfidenceLabel();
  resetSummary();
  setActionEnabled(true);
  bindEvents();
  ensureTimelineCanvasSize();
  drawTimeline();
  state.loopHandle = window.requestAnimationFrame(drawLoop);
}

init();
