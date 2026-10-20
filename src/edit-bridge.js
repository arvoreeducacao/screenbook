import { applyEditOps } from "../viewer/edit-ops.js";

export const EDIT_BRIDGE = `<script>
(function () {
  var applyEditOps = ${applyEditOps.toString()};
  var on = false;
  var scale = 1;
  var selected = null;
  var layer = null;
  var typing = null;
  var drag = null;
  var swallow = false;
  var BLUE = "#0D99FF";
  var SIDES = [["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5]];
  function addressOf(node) {
    var at = [];
    for (var current = node; current && current !== document.body; current = current.parentElement) {
      var parent = current.parentElement;
      if (!parent) return null;
      at.unshift(Array.prototype.indexOf.call(parent.children, current));
    }
    return current === document.body ? at : null;
  }
  function resolve(at) {
    var node = document.body;
    for (var i = 0; i < at.length && node; i++) node = node.children[at[i]];
    return node || null;
  }
  function editable(node) {
    if (!node || node.children.length) return false;
    return /\\S/.test(node.textContent || "") && ["INPUT", "TEXTAREA", "SELECT", "SCRIPT", "STYLE", "svg", "IMG"].indexOf(node.tagName) === -1;
  }
  function ensureLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.id = "__screenbook_edit";
      layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none";
      document.body.appendChild(layer);
    }
    layer.innerHTML = "";
    return layer;
  }
  function draw() {
    ensureLayer();
    if (!on || !selected || !selected.isConnected || typing) return;
    var box = selected.getBoundingClientRect();
    if (!box.width && !box.height) return;
    var size = Math.max(6, 8 / scale);
    var border = Math.max(1, 1 / scale);
    SIDES.forEach(function (side) {
      var handle = document.createElement("div");
      handle.setAttribute("data-handle", side[0]);
      handle.style.cssText = "position:absolute;box-sizing:border-box;pointer-events:auto;background:#fff;border:" + border + "px solid " + BLUE + ";width:" + size + "px;height:" + size + "px;left:" + (box.left + scrollX + box.width * side[1] - size / 2) + "px;top:" + (box.top + scrollY + box.height * side[2] - size / 2) + "px;cursor:" + side[0] + "-resize";
      layer.appendChild(handle);
    });
  }
  function redraw() {
    document.dispatchEvent(new CustomEvent("screenbook:redraw"));
    draw();
  }
  function finishTyping(keep) {
    if (!typing) return;
    var node = typing.node;
    var before = typing.before;
    var outline = typing.outline;
    typing = null;
    node.removeAttribute("contenteditable");
    node.style.outline = outline;
    if (!node.getAttribute("style")) node.removeAttribute("style");
    var value = node.textContent;
    if (!keep) node.textContent = before;
    else if (value !== before) parent.postMessage({ type: "sb-edit-text", at: addressOf(node), value: value }, "*");
    redraw();
  }
  function startTyping(node) {
    if (!on || !editable(node)) return false;
    finishTyping(true);
    typing = { node: node, before: node.textContent, outline: node.style.outline };
    try { node.contentEditable = "plaintext-only"; } catch (error) { node.contentEditable = "true"; }
    if (node.contentEditable !== "plaintext-only") node.contentEditable = "true";
    node.style.outline = Math.max(1, 1.5 / scale) + "px solid " + BLUE;
    node.focus();
    var range = document.createRange();
    range.selectNodeContents(node);
    var picked = getSelection();
    picked.removeAllRanges();
    picked.addRange(range);
    draw();
    return true;
  }
  function inTyping(target) {
    return typing && target && typing.node.contains(target);
  }
  ["mousedown", "mouseup", "pointerdown", "pointerup", "click"].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (!on) return;
      if (inTyping(event.target)) {
        event.stopPropagation();
        return;
      }
      if (type === "mousedown") swallow = false;
      if (typing && type === "mousedown") finishTyping(true);
      if (swallow && type === "click") {
        swallow = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var handle = event.target && event.target.getAttribute && event.target.getAttribute("data-handle");
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      if (type === "mousedown" && selected) {
        var box = selected.getBoundingClientRect();
        drag = { side: handle, x: event.clientX, y: event.clientY, w: box.width, h: box.height, width: selected.style.width, height: selected.style.height };
      }
    }, true);
  });
  window.addEventListener("mousemove", function (event) {
    if (!drag || !selected) return;
    event.stopPropagation();
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (/e$/.test(drag.side)) drag.nw = drag.w + dx;
    if (/w$/.test(drag.side)) drag.nw = drag.w - dx;
    if (/^s/.test(drag.side)) drag.nh = drag.h + dy;
    if (/^n/.test(drag.side)) drag.nh = drag.h - dy;
    if (drag.nw !== undefined) selected.style.width = Math.max(1, Math.round(drag.nw)) + "px";
    if (drag.nh !== undefined) selected.style.height = Math.max(1, Math.round(drag.nh)) + "px";
    redraw();
  }, true);
  window.addEventListener("mouseup", function () {
    if (!drag || !selected) return;
    var done = drag;
    drag = null;
    swallow = done.nw !== undefined || done.nh !== undefined;
    var width = done.nw !== undefined ? Math.max(1, Math.round(done.nw)) + "px" : null;
    var height = done.nh !== undefined ? Math.max(1, Math.round(done.nh)) + "px" : null;
    selected.style.width = done.width;
    selected.style.height = done.height;
    if (!selected.getAttribute("style")) selected.removeAttribute("style");
    if (width || height) parent.postMessage({ type: "sb-edit-resize", at: addressOf(selected), width: width, height: height }, "*");
  }, true);
  window.addEventListener("dblclick", function (event) {
    if (!on) return;
    if (inTyping(event.target)) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    var target = event.target;
    if (target && target.nodeType === 1 && editable(target)) startTyping(target);
  }, true);
  window.addEventListener("keydown", function (event) {
    if (!on) return;
    if (typing) {
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        finishTyping(true);
      }
      return;
    }
    var mod = event.metaKey || event.ctrlKey;
    var name = null;
    if (mod && (event.key === "z" || event.key === "Z")) name = event.shiftKey ? "redo" : "undo";
    else if (mod && (event.key === "y" || event.key === "Y")) name = "redo";
    else if (mod && (event.key === "d" || event.key === "D")) name = "duplicate";
    else if (mod && event.altKey && (event.key === "g" || event.key === "G" || event.code === "KeyG")) name = "wrap";
    else if (!mod && (event.key === "Backspace" || event.key === "Delete") && selected) name = "delete";
    else if (event.altKey && event.key === "ArrowUp" && selected) name = "up";
    else if (event.altKey && event.key === "ArrowDown" && selected) name = "down";
    else if (!mod && event.key === "Enter" && selected && startTyping(selected)) name = "typing";
    if (!name) return;
    event.preventDefault();
    event.stopPropagation();
    if (name !== "typing") parent.postMessage({ type: "sb-edit-key", key: name }, "*");
  }, true);
  window.addEventListener("resize", draw);
  document.addEventListener("screenbook:pick", function (event) {
    if (typing && event.detail !== typing.node) finishTyping(true);
    selected = event.detail || null;
    draw();
  });
  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "sb-edit") {
      on = !!data.on;
      scale = Number(data.scale) > 0 ? Number(data.scale) : 1;
      if (!on) finishTyping(true);
      draw();
    }
    if (data.type === "sb-edit-ops" && Array.isArray(data.ops)) {
      finishTyping(true);
      applyEditOps(document, data.ops);
      redraw();
    }
    if (data.type === "sb-edit-type" && Array.isArray(data.at)) {
      var node = resolve(data.at);
      if (node) startTyping(node);
    }
  });
})();
</script>`;
