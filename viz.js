"use strict";

// import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

class AudioVisualizer {
  constructor() {
    this.frequencySamples = 512;
    this.timeSamples = 512;
    this.audioContext = null;
    this.analyser = null;
    this.audioSource = null;
    this.audioData = null;

    // Three.js components
    this.camera = null;
    this.scene = null;
    this.renderer = null;
    this.mesh = null;
    this.lineGeometry = null;
    this.line = null;
    this.axes = null;

    // Add median line properties
    this.medianLine = null;
    this.medianGeometry = null;
    this.medianHistory = [];
    this.medianHistoryLength = this.timeSamples + 1; // Match xSegments + 1

    // Visualization parameters
    this.heights = null;
    this.nVertices = (this.frequencySamples + 1) * (this.timeSamples + 1);
    this.dimensions = {
      xSize: 35,
      ySize: 20,
      xSegments: this.timeSamples,
      ySegments: this.frequencySamples,
    };
    this.displacementScale = 0.04;

    this.linesVisible = false;
    this.paused = false;
    this.colorRange = 50; // 0 to 100
    this.currentColormap = "jet";

    // Add animation properties
    this.cameraPositions = [
      [new THREE.Vector3(-40, 5, 0), new THREE.Vector3(0, 5, 0)],
      [new THREE.Vector3(-40, 20, 30), new THREE.Vector3(0, 0, 0)],
      [new THREE.Vector3(0, 40, -1), new THREE.Vector3(0, 0, 0)],
    ];
    this.isCameraAnimating = false;
    this.animationStartTime = 0;
    this.animationDuration = 3000;
    this.currentCameraPosition = 0;

    // Add opacity animation properties
    this.surfaceOpacity = 0.0;
    this.targetOpacity = 1.0;
    this.isOpacityAnimating = false;
    this.opacityAnimationStartTime = 0;
    this.opacityAnimationDuration = 2000;

    this.isDisplacementAnimating = false;
    this.displacementScaleAnimationStartTime = 0;
    this.displacementScaleAnimationDuration = 2000;

    // Bind methods
    this.animate = this.animate.bind(this);
    this.render = this.render.bind(this);
    this.updateGeometry = this.updateGeometry.bind(this);
    this.updateCameraPosition = this.updateCameraPosition.bind(this);
    this.toggleColormap = this.toggleColormap.bind(this);
  }

  createSprite(text, position) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;
    context.font = "32px Arial";
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);
    sprite.scale.set(5, 1.25, 1);
    return sprite;
  }

  createAxes() {
    const { xSize, ySize } = this.dimensions;
    const axesHelper = new THREE.Group();

    // Create axes lines
    const xAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(
          -xSize / 2 - 1,
          0,
          this.currentCameraPosition === 2 ? -ySize / 2 : ySize / 2,
        ),
        new THREE.Vector3(
          xSize / 2,
          0,
          this.currentCameraPosition === 2 ? -ySize / 2 : ySize / 2,
        ),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );

    const yAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-xSize / 2, 0, -ySize / 2 - 1),
        new THREE.Vector3(-xSize / 2, 0, ySize / 2 + 1),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );

    const zAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-xSize / 2, -1, -ySize / 2),
        new THREE.Vector3(-xSize / 2, 11, -ySize / 2),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );

    // Add axis labels using sprites
    const xLabel = this.createSprite(
      "Time (s)",
      new THREE.Vector3(
        xSize / 2 + 1,
        0,
        this.currentCameraPosition === 2 ? -ySize / 2 - 2 : ySize / 2 + 2,
      ),
    );
    const yLabel = this.createSprite(
      "Freq. (Hz)",
      new THREE.Vector3(-xSize / 2 - 2, 0, ySize / 2 + 2),
    );
    const zLabel = this.createSprite(
      "Power (dB)",
      new THREE.Vector3(-xSize / 2, 12, -ySize / 2),
    );

    // Add all elements to the group
    if (this.currentCameraPosition == 0) {
      axesHelper.add(yAxis, zAxis, yLabel, zLabel);
    } else {
      axesHelper.add(xAxis, yAxis, zAxis, xLabel, yLabel, zLabel);
    }

    return axesHelper;
  }

  async initAudio() {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.minDecibels = -120;
    this.analyser.maxDecibels = -60;
    this.analyser.fftSize = 4 * this.frequencySamples;
    this.analyser.smoothingTimeConstant = 0.85;
    this.audioData = new Uint8Array(this.analyser.frequencyBinCount);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false },
      });
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.audioSource.connect(this.analyser);
    } catch (error) {
      console.error("Error accessing audio input:", error);
    }
  }

  createMedianLine() {
    const { xSize, ySize, xSegments } = this.dimensions;
    const positions = new Float32Array((xSegments + 1) * 3);

    // Initialize points array with valid values
    for (let i = 0; i <= xSegments; i++) {
      const x = -((i / xSegments) * xSize - xSize / 2);
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }

    const geometry = new LineGeometry();
    geometry.setPositions(positions);

    const material = new LineMaterial({
      color: 0xffffff,
      linewidth: 2,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      dashed: false,
    });

    this.medianGeometry = geometry;
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    return line;
  }

  createFFTLine() {
    const { xSize, ySize, ySegments } = this.dimensions;
    const positions = new Float32Array((ySegments + 1) * 3);

    for (let i = 0; i <= ySegments; i++) {
      const y = (i / ySegments) * ySize - ySize / 2;
      positions[i * 3] = -xSize / 2;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = y;
    }

    const geometry = new LineGeometry();
    geometry.setPositions(positions);

    const material = new LineMaterial({
      color: 0xffffff,
      linewidth: 3,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      dashed: false,
    });

    this.lineGeometry = geometry;
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    return line;
  }

  createMultipleFFTLines() {
    const { xSize, ySize, xSegments, ySegments } = this.dimensions;
    const linesGroup = new THREE.Group();

    // Material for the filled shape (red)
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      side: THREE.DoubleSide,
    });

    // Material for the line (white)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });

    this.lineProperties = [];

    for (let i = 0; i <= xSegments; i++) {
      const segmentCount = ySegments * 2;

      // Create filled shape
      const shapeVertices = [];
      const shapeIndices = [];
      const lineVertices = [];
      const x = -((i / xSegments) * xSize - xSize / 2);

      // Create vertices for both shape and line
      for (let j = 0; j <= segmentCount; j++) {
        const z = (j / segmentCount) * ySize - ySize / 2;

        // Vertices for the line
        lineVertices.push(x, 0, z);

        // Vertices for the shape (curve point and bottom point)
        shapeVertices.push(x, 0, z); // curve point
        shapeVertices.push(x, 0, z); // bottom point

        // Create triangles for the shape
        if (j > 0) {
          const baseIndex = (j - 1) * 2;
          shapeIndices.push(
            baseIndex,
            baseIndex + 1,
            baseIndex + 2,
            baseIndex + 1,
            baseIndex + 3,
            baseIndex + 2,
          );
        }
      }

      // Create shape mesh
      const shapeGeometry = new THREE.BufferGeometry();
      shapeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(shapeVertices, 3),
      );
      shapeGeometry.setIndex(shapeIndices);
      const shapeMesh = new THREE.Mesh(shapeGeometry, fillMaterial.clone());

      // Create line geometry
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(lineVertices, 3),
      );
      const line = new THREE.Line(lineGeometry, lineMaterial.clone());

      // Create a group for this slice
      const sliceGroup = new THREE.Group();
      sliceGroup.add(shapeMesh);
      sliceGroup.add(line);

      this.lineProperties.push({
        opacity: i % 20 === 0 ? i / xSegments : 0,
      });

      // Set opacity for both shape and line
      shapeMesh.material.opacity = this.lineProperties[i].opacity;
      line.material.opacity = this.lineProperties[i].opacity;

      linesGroup.add(sliceGroup);
    }

    this.scrollOffset = 0;
    return linesGroup;
  }

  createGeometry() {
    const geometry = new THREE.BufferGeometry();
    const indices = [];
    const vertices = [];
    this.heights = [];

    const { xSize, ySize, xSegments, ySegments } = this.dimensions;
    const xHalfSize = xSize / 2;
    const yHalfSize = ySize / 2;
    const xSegmentSize = xSize / xSegments;
    const ySegmentSize = ySize / ySegments;

    // Generate vertices
    for (let i = 0; i <= xSegments; i++) {
      const x = i * xSegmentSize - xHalfSize;
      for (let j = 0; j <= ySegments; j++) {
        const y = j * ySegmentSize - yHalfSize;
        vertices.push(-x, 0, y);
        this.heights.push(0);
      }
    }

    // Generate indices
    for (let i = 0; i < xSegments; i++) {
      for (let j = 0; j < ySegments; j++) {
        const a = i * (ySegments + 1) + (j + 1);
        const b = i * (ySegments + 1) + j;
        const c = (i + 1) * (ySegments + 1) + j;
        const d = (i + 1) * (ySegments + 1) + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.heights = new Uint8Array(this.heights);

    geometry.setIndex(indices);
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute(
      "displacement",
      new THREE.Uint8BufferAttribute(this.heights, 1),
    );

    return geometry;
  }

  createMaterial() {
    const lut = window.COLORMAPS[this.currentColormap].map(
      (color) =>
        new THREE.Vector3(
          (color[0] * 255) / 255,
          (color[1] * 255) / 255,
          (color[2] * 255) / 255,
        ),
    );

    const uniforms = {
      vLut: { type: "v3v", value: lut },
      opacity: { type: "f", value: this.surfaceOpacity },
      displacementScale: { type: "f", value: 0.04 },
      xSize: { type: "f", value: this.dimensions.xSize },
      colorRange: { type: "f", value: this.colorRange / 100.0 },
    };

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: document.getElementById("vertexshader").text,
      fragmentShader: document.getElementById("fragmentshader").text,
      transparent: true,
      depthWrite: false,
    });
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      1,
      1000,
    );
    this.camera.position.set(
      this.cameraPositions[0][0].x,
      this.cameraPositions[0][0].y,
      this.cameraPositions[0][0].z,
    );
    this.camera.lookAt(
      this.cameraPositions[0][1].x,
      this.cameraPositions[0][1].y,
      this.cameraPositions[0][1].z,
    );

    // Create main spectrogram mesh
    const geometry = this.createGeometry();
    const material = this.createMaterial();
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Create and add FFT line
    this.line = this.createFFTLine();
    this.scene.add(this.line);

    // this.medianLine = this.createMedianLine();
    // this.scene.add(this.medianLine);

    // Create and add axes
    this.axes = this.createAxes();
    this.scene.add(this.axes);

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Add to DOM
    const container = document.getElementById("spectrogram");
    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    window.addEventListener("resize", this.onWindowResize.bind(this), false);

    const controls = document.getElementById("controls");

    // Add keyboard event listener for camera toggle
    window.addEventListener("keydown", (event) => {
      if (event.key === "c" || event.key === "C") {
        this.toggleCameraPosition();
      }
      if (event.key === "s" || event.key === "S") {
        this.toggleSurfaceVisibility();
      }
      if (event.key === "t" || event.key === "T") {
        this.toggleLinesVisibility();
      }
      if (event.key === "3") {
        this.toggleDisplacement();
      }
      if (event.key === "m" || event.key === "M") {
        this.toggleColormap();
      }
      if (event.key === "9") {
        this.toggleMedianVisibility();
      }
      if (event.key === "p" || event.key === "M") {
        this.togglePause();
      }
    });

    document.getElementById("play-pause").addEventListener("click", () => {
      this.togglePause();
    });

    document.getElementById("toggle-colormap").addEventListener("click", () => {
      this.toggleColormap();
    });

    document.getElementById("toggle-camera").addEventListener("click", () => {
      this.toggleCameraPosition();
    });

    document
      .getElementById("toggle-fft-median")
      .addEventListener("click", () => {
        this.toggleMedianVisibility();
      });

    document
      .getElementById("toggle-fft-traces")
      .addEventListener("click", () => {
        this.toggleLinesVisibility();
      });

    document
      .getElementById("toggle-fft-surface")
      .addEventListener("click", () => {
        this.toggleSurfaceVisibility();
      });

    document
      .getElementById("color-range")
      .addEventListener("input", (event) => {
        this.colorRange = parseFloat(event.target.value);
      });

    // Compute normals
    this.mesh.geometry.computeVertexNormals();
  }

  updateGeometry() {
    if (!this.paused) {
      this.analyser.getByteFrequencyData(this.audioData);

      const startVal = this.frequencySamples + 1;
      const endVal = this.nVertices - startVal;

      this.heights.copyWithin(0, startVal, this.nVertices + 1);
      this.heights.set(this.audioData, endVal - startVal);

      this.mesh.geometry.setAttribute(
        "displacement",
        new THREE.Uint8BufferAttribute(this.heights, 1),
      );

      // Update lines if they exist
      if (this.linesGroup) {
        this.scrollOffset = (this.scrollOffset + 1) % 20;
        const { xSize, ySize, xSegments, ySegments } = this.dimensions;

        this.linesGroup.children.forEach((sliceGroup, i) => {
          const shapeMesh = sliceGroup.children[0];
          const line = sliceGroup.children[1];
          const x = -(i / xSegments) * xSize + xSize / 2;
          const effectivePosition = (i + this.scrollOffset) % (xSegments + 1);
          const visible = effectivePosition % 20 == 0;
          const opacity = visible
            ? Math.min(1, effectivePosition / xSegments)
            : 0;

          shapeMesh.material.opacity = 1;
          line.material.opacity = opacity;

          shapeMesh.material.visible = visible;
          line.material.visible = visible;

          if (i < this.linesGroup.children.length - 1) {
            const nextSlice = this.linesGroup.children[i + 1];
            const nextShapeMesh = nextSlice.children[0];
            const nextLine = nextSlice.children[1];

            // Update shape vertices
            const shapePositions = shapeMesh.geometry.attributes.position.array;
            const nextShapePositions =
              nextShapeMesh.geometry.attributes.position.array;
            for (let j = 0; j < shapePositions.length; j += 6) {
              // Update curve vertex
              shapePositions[j] = x;
              shapePositions[j + 1] = nextShapePositions[j + 1];

              // Update bottom vertex
              shapePositions[j + 3] = x;
              shapePositions[j + 4] = 0;
            }
            shapeMesh.geometry.attributes.position.needsUpdate = true;

            // Update line vertices
            const linePositions = line.geometry.attributes.position.array;
            const nextLinePositions =
              nextLine.geometry.attributes.position.array;
            for (let j = 0; j < linePositions.length; j += 3) {
              linePositions[j] = x;
              linePositions[j + 1] = nextLinePositions[j + 1];
            }
            line.geometry.attributes.position.needsUpdate = true;
          } else {
            const segmentCount = ySegments * 2;
            const shapePositions = shapeMesh.geometry.attributes.position.array;
            const linePositions = line.geometry.attributes.position.array;

            for (let j = 0; j <= segmentCount; j++) {
              const z = (j / segmentCount) * ySize - ySize / 2;
              const audioIndex = Math.floor((j / segmentCount) * ySegments);
              const nextAudioIndex = Math.min(audioIndex + 1, ySegments - 1);
              const fraction = (j / segmentCount) * ySegments - audioIndex;
              const value =
                this.audioData[audioIndex] * (1 - fraction) +
                this.audioData[nextAudioIndex] * fraction;
              const height = value / 25.5;

              // Update shape vertices
              const shapeIndex = j * 6;
              shapePositions[shapeIndex] = x; // curve x
              shapePositions[shapeIndex + 1] = height; // curve y
              shapePositions[shapeIndex + 2] = z; // curve z
              shapePositions[shapeIndex + 3] = x; // bottom x
              shapePositions[shapeIndex + 4] = 0; // bottom y
              shapePositions[shapeIndex + 5] = z; // bottom z

              // Update line vertices
              const lineIndex = j * 3;
              linePositions[lineIndex] = x;
              linePositions[lineIndex + 1] = height;
              linePositions[lineIndex + 2] = z;
            }

            shapeMesh.geometry.attributes.position.needsUpdate = true;
            line.geometry.attributes.position.needsUpdate = true;
          }
        });
      }

      // Update FFT line
      if (this.line) {
        const { xSize, ySize, xSegments, ySegments } = this.dimensions;
        const positions = new Float32Array((ySegments + 1) * 3);
        for (let i = 0; i <= ySegments; i++) {
          const y = (i / ySegments) * ySize - ySize / 2;
          const z = this.audioData[i] / 25.5;
          positions[i * 3] = -xSize / 2;
          positions[i * 3 + 1] = z;
          positions[i * 3 + 2] = y;
        }
        this.lineGeometry.setPositions(positions);
      }

      // Update median line
      const { xSize, ySize, xSegments, ySegments } = this.dimensions;

      // Calculate new median for latest spectrum
      const medianIndex = this.calculateSpectrumMedian(
        this.audioData.slice(0, ySegments),
      );
      const normalizedMedian = (medianIndex / ySegments) * ySize - ySize / 2;

      // Add new value to history and remove oldest if needed
      this.medianHistory.push(normalizedMedian);
      if (this.medianHistory.length > this.medianHistoryLength) {
        this.medianHistory.shift();
      }

      if (this.medianLine) {
        const positions = new Float32Array((xSegments + 1) * 3);
        for (let i = 0; i <= xSegments; i++) {
          const x = -((i / xSegments) * xSize - xSize / 2);
          positions[i * 3] = x;
          positions[i * 3 + 1] = 0.1;
          positions[i * 3 + 2] = this.medianHistory[i] || 0; // Use 0 as fallback
        }

        // Update geometry with new positions
        this.medianGeometry.setPositions(positions);
      }
    }

    this.mesh.material.uniforms.colorRange.value = this.colorRange / 100.0;
  }

  render() {
    this.updateGeometry();
    this.renderer.render(this.scene, this.camera);
  }

  toggleCameraPosition() {
    if (this.isCameraAnimating) return;

    this.isCameraAnimating = true;
    this.animationStartTime = performance.now();

    // Calculate next camera position
    const nextPosition =
      (this.currentCameraPosition + 1) % this.cameraPositions.length;

    // Set start and target positions based on current position
    this.startPosition =
      this.cameraPositions[this.currentCameraPosition][0].clone();
    this.targetPosition = this.cameraPositions[nextPosition][0].clone();

    this.startLookAtPosition =
      this.cameraPositions[this.currentCameraPosition][1].clone();
    this.targetLookAtPosition = this.cameraPositions[nextPosition][1].clone();

    // Update the current position indicator
    this.currentCameraPosition = nextPosition;

    // Remove old axes and create new ones
    if (this.axes) {
      this.scene.remove(this.axes);
    }
    this.axes = this.createAxes();
    this.scene.add(this.axes);

    // Start displacement scale animation based on next camera position
    window.setTimeout(() => {
      this.isDisplacementAnimating = true;
      this.displacementScaleAnimationStartTime = performance.now();
      this.targetDisplacementScale = nextPosition === 2 ? 0.0 : 0.04;
    }, 1000);
  }

  // Cubic easing function for smooth animation
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  calculateSpectrumMedian(spectrum) {
    if (!spectrum || spectrum.length === 0) {
      console.warn("Empty spectrum data");
      return 0;
    }

    // Calculate total power
    const totalPower = spectrum.reduce((sum, value) => sum + value, 0);
    if (totalPower === 0) return 0;

    const halfPower = totalPower * 0.92;
    let cumulativePower = 0;

    // Find frequency where cumulative power reaches half
    for (let i = 0; i < spectrum.length; i++) {
      cumulativePower += spectrum[i];
      if (cumulativePower >= halfPower) {
        return i;
      }
    }
    return 0;
  }

  updateCameraPosition(currentTime) {
    if (!this.isCameraAnimating) return;

    const elapsed = currentTime - this.animationStartTime;
    const progress = Math.min(elapsed / this.animationDuration, 1);

    // Use cubic easing for smooth acceleration and deceleration
    const easedProgress = this.easeInOutCubic(progress);

    // Interpolate between start and target positions
    const newPosition = new THREE.Vector3().lerpVectors(
      this.startPosition,
      this.targetPosition,
      easedProgress,
    );

    // Interpolate between start and target look at positions
    const newLookAtPosition = new THREE.Vector3().lerpVectors(
      this.startLookAtPosition,
      this.targetLookAtPosition,
      easedProgress,
    );

    // Update camera position
    this.camera.position.copy(newPosition);
    this.camera.lookAt(
      newLookAtPosition.x,
      newLookAtPosition.y,
      newLookAtPosition.z,
    );

    // Check if animation is complete
    if (progress >= 1) {
      this.isCameraAnimating = false;
    }
  }

  toggleSurfaceVisibility() {
    if (this.isOpacityAnimating) return;

    this.isOpacityAnimating = true;
    this.opacityAnimationStartTime = performance.now();

    // Toggle between 0 and 1
    this.targetOpacity = this.surfaceOpacity > 0.5 ? 0.0 : 1.0;
  }

  updateSurfaceOpacity(currentTime) {
    if (!this.isOpacityAnimating) return;
    const elapsed = currentTime - this.opacityAnimationStartTime;
    const progress = Math.min(elapsed / this.opacityAnimationDuration, 1);
    const easedProgress = this.easeInOutCubic(progress);
    this.surfaceOpacity =
      this.surfaceOpacity +
      (this.targetOpacity - this.surfaceOpacity) * easedProgress;
    this.mesh.material.uniforms.opacity.value = this.surfaceOpacity;
    if (progress >= 1) {
      this.isOpacityAnimating = false;
      this.surfaceOpacity = this.targetOpacity;
    }
  }

  toggleDisplacement() {
    if (this.isDisplacementAnimating) return;
    this.isDisplacementAnimating = true;
    this.displacementScaleAnimationStartTime = performance.now();
    this.targetDisplacementScale = this.displacementScale > 0 ? 0.0 : 0.04;
  }

  updateDisplacement(currentTime) {
    if (!this.isDisplacementAnimating) return;
    const elapsed = currentTime - this.displacementScaleAnimationStartTime;
    const progress = Math.min(
      elapsed / this.displacementScaleAnimationDuration,
      1,
    );
    const easedProgress = this.easeInOutCubic(progress);
    this.displacementScale =
      this.displacementScale +
      (this.targetDisplacementScale - this.displacementScale) * easedProgress;
    this.mesh.material.uniforms.displacementScale.value =
      this.displacementScale;
    if (progress >= 1) {
      this.isDisplacementAnimating = false;
      this.displacementScale = this.targetDisplacementScale;
    }
  }

  toggleLinesVisibility() {
    if (!this.linesGroup) {
      this.linesGroup = this.createMultipleFFTLines();
      this.scene.add(this.linesGroup);
    } else {
      this.scene.remove(this.linesGroup);
      this.linesGroup = null;
    }
    // this.linesVisible = !this.linesVisible;
    // this.linesGroup.visible = this.linesVisible;
  }

  toggleMedianVisibility() {
    if (!this.medianLine) {
      this.medianLine = this.createMedianLine();
      this.scene.add(this.medianLine);
    } else {
      this.medianLine.visible = !this.medianLine.visible;
    }
  }

  togglePause() {
    this.paused = !this.paused;
    const button = document.getElementById("play-pause");
    button.textContent = this.paused ? "Play" : "Pause";
  }

  toggleColormap() {
    // Toggle between available colormaps
    this.currentColormap =
      this.currentColormap === "viridis" ? "jet" : "viridis";

    // Update the material uniforms with new colormap
    const lut = window.COLORMAPS[this.currentColormap].map(
      (color) =>
        new THREE.Vector3(
          (color[0] * 255 - 49) / 206,
          (color[1] * 255 - 19) / 236,
          (color[2] * 255 - 50) / 190,
        ),
    );

    this.mesh.material.uniforms.vLut.value = lut;
  }

  animate() {
    requestAnimationFrame(this.animate);
    const currentTime = performance.now();
    this.updateCameraPosition(currentTime);
    this.updateSurfaceOpacity(currentTime);
    this.updateDisplacement(currentTime);
    this.render();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update line material resolutions
    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    if (this.line?.material) {
      this.line.material.resolution = resolution;
    }
    if (this.medianLine?.material) {
      this.medianLine.material.resolution = resolution;
    }
  }

  async start() {
    await this.initAudio();
    this.init();
    this.animate();
  }
}

// Initialize visualizer on first click
let visualizer = null;
document.addEventListener("click", () => {
  if (!visualizer) {
    visualizer = new AudioVisualizer();
    visualizer.start();
  }
});
