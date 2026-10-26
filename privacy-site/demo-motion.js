import * as THREE from "./vendor/three.module.js";

(function () {
  var canvas = document.getElementById("field");
  if (typeof gsap !== "undefined") {
    startMotion();
  }
  if (canvas) {
    startField(canvas);
  }

  function startField(target) {
    try {
      drawField(target);
    } catch (error) {
      target.hidden = true;
    }
  }

  function drawField(target) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: target,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      target.hidden = true;
      return;
    }
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8eaef);
    var camera = new THREE.OrthographicCamera(-1.8, 1.8, 1, -1, 0.1, 10);
    camera.position.z = 5;

    var material = new THREE.MeshBasicMaterial({ color: 0x101114 });
    var group = new THREE.Group();
    var widths = [1.7, 0.95, 1.45, 0.55, 1.2, 0.75, 1.55];
    for (var index = 0; index < widths.length; index += 1) {
      var line = new THREE.Mesh(new THREE.PlaneGeometry(widths[index], 0.07), material);
      line.position.set(index % 2 === 0 ? -0.35 : 0.22, 0.72 - index * 0.24, 0);
      group.add(line);
    }
    scene.add(group);

    function fit() {
      var width = target.clientWidth || 720;
      var height = target.clientHeight || 200;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      var aspect = width / Math.max(height, 1);
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
    }

    fit();
    renderer.render(scene, camera);

    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return;
    }

    var running = true;
    var raf = 0;
    function frame(now) {
      if (!running) {
        return;
      }
      group.position.x = Math.sin(now * 0.0004) * 0.06;
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(frame);
    }
    raf = window.requestAnimationFrame(frame);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(raf);
        return;
      }
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    });
    window.addEventListener("resize", function () {
      fit();
      renderer.render(scene, camera);
    });
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () {
        fit();
        renderer.render(scene, camera);
      });
      observer.observe(target);
    }
  }

  function startMotion() {
    gsap.defaults({ duration: 0.6, ease: "power2.out" });
    var motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", function () {
      var timeline = gsap.timeline();
      timeline
        .from(".stage", { y: 18, duration: 0.7 })
        .from(".case", { y: 14, stagger: 0.08, duration: 0.45 }, 0.2);
    });
  }
})();
