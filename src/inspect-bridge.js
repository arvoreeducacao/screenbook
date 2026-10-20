export const INSPECT_BRIDGE = `<script>
(function () {
  var inspecting = false;
  var playing = false;
  var hotspots = [];
  var selected = null;
  var hovered = null;
  var alt = false;
  var layer = null;
  var BLUE = "#0D99FF";
  var RED = "#F24822";
  var STYLE_KEYS = ["display", "position", "flexDirection", "flexWrap", "justifyContent", "alignItems", "gap", "rowGap", "columnGap", "gridTemplateColumns",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "backgroundColor", "backgroundImage", "color", "opacity",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopStyle", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius", "boxShadow",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textAlign", "textTransform", "textDecorationLine", "whiteSpace",
    "overflow", "zIndex", "cursor", "objectFit"];
  function own(node) {
    return node && node.nodeType === 1 && node !== document.documentElement && !(layer && layer.contains(node)) && !(node.closest && node.closest("#__screenbook_pins, #__screenbook_edit"));
  }
  function pageBox(node) {
    var box = node.getBoundingClientRect();
    return { x: box.left + scrollX, y: box.top + scrollY, w: box.width, h: box.height };
  }
  function labelOf(node) {
    var el = node.getAttribute("data-el");
    if (el) return el;
    var name = node.tagName.toLowerCase();
    if (node.id) return name + "#" + node.id;
    var classes = (node.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    return classes.length ? name + "." + classes.join(".") : name;
  }
  function pathOf(node) {
    var path = [];
    for (var current = node; current && current !== document.documentElement; current = current.parentElement) path.unshift(current);
    return path;
  }
  function addressOf(node) {
    var at = [];
    for (var current = node; current && current !== document.body; current = current.parentElement) {
      var holder = current.parentElement;
      if (!holder) return null;
      at.unshift(Array.prototype.indexOf.call(holder.children, current));
    }
    return current === document.body ? at : null;
  }
  function round(value) {
    return Math.round(value * 100) / 100;
  }
  function info(node) {
    var cs = getComputedStyle(node);
    var styles = {};
    STYLE_KEYS.forEach(function (key) { styles[key] = cs[key]; });
    var path = pathOf(node);
    var html = node.outerHTML;
    var text = node.innerText || node.textContent || "";
    return {
      label: labelOf(node),
      tag: node.tagName.toLowerCase(),
      el: node.getAttribute("data-el"),
      box: { x: round(pageBox(node).x), y: round(pageBox(node).y), w: round(pageBox(node).w), h: round(pageBox(node).h) },
      styles: styles,
      text: text.trim().slice(0, 400),
      leaf: !node.children.length,
      ownText: hasText(node),
      html: html.length > 60000 ? html.slice(0, 60000) : html,
      truncated: html.length > 60000,
      path: path.map(function (item, index) { return { label: labelOf(item), depth: index }; }),
      depth: path.length - 1,
      at: addressOf(node),
      piece: node.closest("[data-el]") ? node.closest("[data-el]").getAttribute("data-el") : null,
      inlineStyle: node.getAttribute("style") || ""
    };
  }
  function ensureLayer() {
    if (layer && layer.isConnected) {
      layer.innerHTML = "";
      return layer;
    }
    layer = document.createElement("div");
    layer.id = "__screenbook_inspect";
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none";
    document.body.appendChild(layer);
    return layer;
  }
  function rect(box, css) {
    var node = document.createElement("div");
    node.style.cssText = "position:absolute;box-sizing:border-box;left:" + box.x + "px;top:" + box.y + "px;width:" + box.w + "px;height:" + box.h + "px;" + css;
    layer.appendChild(node);
    return node;
  }
  function badge(text, x, y, color) {
    var node = document.createElement("span");
    node.textContent = text;
    node.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;transform:translateX(-50%);background:" + color + ";color:#fff;font:600 11px/1 system-ui,sans-serif;padding:3px 5px;border-radius:3px;white-space:nowrap";
    layer.appendChild(node);
  }
  function line(x1, y1, x2, y2, value, dashed) {
    var horizontal = y1 === y2;
    var box = horizontal ? { x: Math.min(x1, x2), y: y1, w: Math.abs(x2 - x1), h: 0 } : { x: x1, y: Math.min(y1, y2), w: 0, h: Math.abs(y2 - y1) };
    rect(box, horizontal ? "border-top:1px " + (dashed ? "dashed" : "solid") + " " + RED : "border-left:1px " + (dashed ? "dashed" : "solid") + " " + RED);
    if (value > 0 && !dashed) badge(String(round(value)), horizontal ? box.x + box.w / 2 : box.x + 4, horizontal ? box.y + 4 : box.y + box.h / 2 - 8, RED);
  }
  function inside(a, b) {
    return a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
  }
  function measure(a, b) {
    rect(b, "border:1px solid " + RED);
    if (inside(a, b) || inside(b, a)) {
      var inner = inside(a, b) ? a : b;
      var outer = inner === a ? b : a;
      var midX = inner.x + inner.w / 2;
      var midY = inner.y + inner.h / 2;
      line(outer.x, midY, inner.x, midY, inner.x - outer.x);
      line(inner.x + inner.w, midY, outer.x + outer.w, midY, outer.x + outer.w - inner.x - inner.w);
      line(midX, outer.y, midX, inner.y, inner.y - outer.y);
      line(midX, inner.y + inner.h, midX, outer.y + outer.h, outer.y + outer.h - inner.y - inner.h);
      return;
    }
    var top = Math.max(a.y, b.y);
    var bottom = Math.min(a.y + a.h, b.y + b.h);
    var left = Math.max(a.x, b.x);
    var right = Math.min(a.x + a.w, b.x + b.w);
    var y = top < bottom ? (top + bottom) / 2 : a.y + a.h / 2;
    var x = left < right ? (left + right) / 2 : a.x + a.w / 2;
    if (b.x >= a.x + a.w) line(a.x + a.w, y, b.x, y, b.x - a.x - a.w);
    else if (a.x >= b.x + b.w) line(b.x + b.w, y, a.x, y, a.x - b.x - b.w);
    if (b.y >= a.y + a.h) line(x, a.y + a.h, x, b.y, b.y - a.y - a.h);
    else if (a.y >= b.y + b.h) line(x, b.y + b.h, x, a.y, a.y - b.y - b.h);
    if (top >= bottom && (b.x >= a.x + a.w || a.x >= b.x + b.w)) {
      var guideY = b.y > a.y ? b.y : b.y + b.h;
      line(Math.min(a.x, b.x), guideY, Math.max(a.x + a.w, b.x + b.w), guideY, 0, true);
    }
    if (left >= right && (b.y >= a.y + a.h || a.y >= b.y + b.h)) {
      var guideX = b.x > a.x ? b.x : b.x + b.w;
      line(guideX, Math.min(a.y, b.y), guideX, Math.max(a.y + a.h, b.y + b.h), 0, true);
    }
  }
  function spacing(node, box) {
    var cs = getComputedStyle(node);
    var pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight), pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft);
    var fill = "background:rgba(13,153,255,.12)";
    if (pt) rect({ x: box.x, y: box.y, w: box.w, h: pt }, fill);
    if (pb) rect({ x: box.x, y: box.y + box.h - pb, w: box.w, h: pb }, fill);
    if (pl) rect({ x: box.x, y: box.y + pt, w: pl, h: box.h - pt - pb }, fill);
    if (pr) rect({ x: box.x + box.w - pr, y: box.y + pt, w: pr, h: box.h - pt - pb }, fill);
  }
  function draw() {
    if (!inspecting) {
      if (layer) layer.remove();
      layer = null;
      return;
    }
    ensureLayer();
    var hoverBox = hovered && hovered !== selected && hovered.isConnected ? pageBox(hovered) : null;
    if (selected && selected.isConnected) {
      var box = pageBox(selected);
      if (!(alt && hoverBox)) spacing(selected, box);
      rect(box, "border:1.5px solid " + BLUE);
      badge(round(box.w) + " × " + round(box.h), box.x + box.w / 2, box.y + box.h + 6, BLUE);
      if (alt && hoverBox) return measure(box, hoverBox);
    }
    if (hoverBox) rect(hoverBox, "border:1px solid " + BLUE);
  }
  function pick(node) {
    selected = node;
    draw();
    document.dispatchEvent(new CustomEvent("screenbook:pick", { detail: node }));
    parent.postMessage({ type: "sb-inspect-pick", info: node ? info(node) : null }, "*");
  }
  function cssRules() {
    var rules = [];
    for (var s = 0; s < document.styleSheets.length; s++) {
      var list = null;
      try { list = document.styleSheets[s].cssRules; } catch (error) { list = null; }
      if (!list) continue;
      (function walk(items) {
        for (var r = 0; r < items.length; r++) {
          if (items[r].cssRules && !items[r].style) walk(items[r].cssRules);
          else if (items[r].style) rules.push(items[r]);
        }
      })(list);
    }
    return rules;
  }
  function tokens() {
    var declared = [];
    var seen = {};
    var used = {};
    var rules = cssRules();
    rules.forEach(function (rule) {
      var selector = rule.selectorText || "";
      var root = /(^|,)\\s*(:root|html)\\s*(,|$)/.test(selector);
      for (var i = 0; i < rule.style.length; i++) {
        var prop = rule.style[i];
        var value = rule.style.getPropertyValue(prop);
        if (prop.indexOf("--") === 0 && root && !seen[prop]) {
          seen[prop] = true;
          declared.push(prop);
        }
        if (!root || prop.indexOf("--") !== 0) {
          var refs = value.match(/var\\(\\s*--[\\w-]+/g) || [];
          refs.forEach(function (ref) { used[ref.replace(/var\\(\\s*/, "")] = true; });
        }
      }
    });
    document.querySelectorAll("[style]").forEach(function (node) {
      var refs = (node.getAttribute("style") || "").match(/var\\(\\s*--[\\w-]+/g) || [];
      refs.forEach(function (ref) { used[ref.replace(/var\\(\\s*/, "")] = true; });
    });
    var rootStyle = getComputedStyle(document.documentElement);
    var probe = document.createElement("i");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    var changed = true;
    var guard = 0;
    while (changed && guard++ < 8) {
      changed = false;
      declared.forEach(function (name) {
        if (!used[name]) return;
        var refs = findDeclared(rules, name).match(/var\\(\\s*--[\\w-]+/g) || [];
        refs.forEach(function (ref) {
          var key = ref.replace(/var\\(\\s*/, "");
          if (!used[key]) { used[key] = "via"; changed = true; }
        });
      });
    }
    var result = declared.map(function (name) {
      var value = rootStyle.getPropertyValue(name).trim();
      var color = null;
      if (value && CSS.supports("color", value) && !/^(inherit|initial|unset|currentcolor|transparent)$/i.test(value)) {
        probe.style.color = value;
        color = getComputedStyle(probe).color;
      }
      return { name: name, value: value.slice(0, 200), source: findDeclared(rules, name).slice(0, 200), color: color, used: used[name] === true ? "direct" : used[name] === "via" ? "via" : null };
    });
    probe.remove();
    return result.slice(0, 600);
  }
  function findDeclared(rules, name) {
    for (var i = 0; i < rules.length; i++) {
      var selector = rules[i].selectorText || "";
      if (!/(^|,)\\s*(:root|html)\\s*(,|$)/.test(selector)) continue;
      var value = rules[i].style.getPropertyValue(name);
      if (value) return value.trim();
    }
    return "";
  }
  function visible(node, cs) {
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    var box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function transparent(value) {
    return !value || value === "transparent" || /,\\s*0\\)$/.test(value);
  }
  function styles() {
    var colors = {};
    var fonts = {};
    var nodes = document.body ? document.body.getElementsByTagName("*") : [];
    for (var i = 0; i < nodes.length && i < 5000; i++) {
      var node = nodes[i];
      if (!own(node) || node.tagName === "SCRIPT" || node.tagName === "STYLE") continue;
      var cs = getComputedStyle(node);
      if (!visible(node, cs)) continue;
      var add = function (value, use) {
        if (transparent(value)) return;
        var entry = colors[value] || (colors[value] = { value: value, count: 0, uses: {} });
        entry.count++;
        entry.uses[use] = true;
      };
      add(cs.backgroundColor, "background");
      var direct = false;
      for (var c = 0; c < node.childNodes.length; c++) if (node.childNodes[c].nodeType === 3 && node.childNodes[c].textContent.trim()) direct = true;
      if (direct) {
        add(cs.color, "text");
        var key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.fontStyle].join("|");
        var font = fonts[key] || (fonts[key] = { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, style: cs.fontStyle, count: 0, sample: "" });
        font.count++;
        if (!font.sample) font.sample = (node.textContent || "").trim().slice(0, 60);
      }
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") add(cs.borderTopColor, "border");
      if (node.tagName === "svg" || node.closest("svg")) {
        if (cs.fill && cs.fill !== "none" && cs.fill.indexOf("url(") === -1) add(cs.fill, "icon");
        if (cs.stroke && cs.stroke !== "none" && cs.stroke.indexOf("url(") === -1) add(cs.stroke, "icon");
      }
    }
    var colorList = Object.keys(colors).map(function (key) { var entry = colors[key]; return { value: entry.value, count: entry.count, uses: Object.keys(entry.uses) }; });
    colorList.sort(function (a, b) { return b.count - a.count; });
    var fontList = Object.keys(fonts).map(function (key) { return fonts[key]; });
    fontList.sort(function (a, b) { return parseFloat(b.size) - parseFloat(a.size) || b.count - a.count; });
    return { colors: colorList.slice(0, 80), fonts: fontList.slice(0, 60), tokens: tokens(), size: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight } };
  }
  function highlight(match) {
    ensureLayer();
    var nodes = document.body.getElementsByTagName("*");
    var count = 0;
    for (var i = 0; i < nodes.length && i < 5000 && count < 400; i++) {
      var node = nodes[i];
      if (!own(node)) continue;
      var cs = getComputedStyle(node);
      if (!visible(node, cs)) continue;
      var hit = false;
      if (match.color) hit = cs.backgroundColor === match.color || cs.borderTopColor === match.color && parseFloat(cs.borderTopWidth) > 0 || hasText(node) && cs.color === match.color || (node.closest("svg") && (cs.fill === match.color || cs.stroke === match.color));
      if (match.font) hit = hasText(node) && [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight].join("|") === match.font;
      if (!hit) continue;
      count++;
      rect(pageBox(node), "border:1.5px solid " + BLUE + ";background:rgba(13,153,255,.10)");
    }
  }
  function hasText(node) {
    for (var c = 0; c < node.childNodes.length; c++) if (node.childNodes[c].nodeType === 3 && node.childNodes[c].textContent.trim()) return true;
    return false;
  }
  function hotspotOf(node) {
    for (var current = node; current && current !== document.documentElement; current = current.parentElement) {
      var name = current.getAttribute && current.getAttribute("data-el");
      if (name && hotspots.indexOf(name) !== -1) return current;
    }
    return null;
  }
  function flashHotspots() {
    var old = document.getElementById("__screenbook_hotspots");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "__screenbook_hotspots";
    box.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none";
    hotspots.forEach(function (name) {
      document.querySelectorAll('[data-el="' + CSS.escape(name) + '"]').forEach(function (node) {
        var area = pageBox(node);
        var spot = document.createElement("div");
        spot.style.cssText = "position:absolute;left:" + area.x + "px;top:" + area.y + "px;width:" + area.w + "px;height:" + area.h + "px;background:rgba(13,153,255,.22);border:1.5px solid rgba(13,153,255,.85);border-radius:4px;transition:opacity .5s";
        box.appendChild(spot);
      });
    });
    document.body.appendChild(box);
    setTimeout(function () { box.style.transition = "opacity .4s"; box.style.opacity = "0"; }, 500);
    setTimeout(function () { box.remove(); }, 950);
  }
  document.addEventListener("mousemove", function (event) {
    if (playing) {
      document.documentElement.style.cursor = hotspotOf(event.target) ? "pointer" : "";
      return;
    }
    if (!inspecting) return;
    var target = own(event.target) ? event.target : null;
    if (target === hovered && alt === event.altKey) return;
    hovered = target;
    alt = event.altKey;
    draw();
  }, true);
  document.addEventListener("mouseleave", function () {
    if (!inspecting) return;
    hovered = null;
    draw();
  });
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit", "dblclick"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (!inspecting && !playing) return;
      if (playing && type !== "submit") return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  });
  document.addEventListener("click", function (event) {
    if (playing) {
      event.preventDefault();
      event.stopPropagation();
      var spot = hotspotOf(event.target);
      if (spot) parent.postMessage({ type: "sb-play-go", el: spot.getAttribute("data-el") }, "*");
      else flashHotspots();
      return;
    }
    if (!inspecting) return;
    event.preventDefault();
    event.stopPropagation();
    pick(own(event.target) ? event.target : null);
  }, true);
  function key(event) {
    if (event.key === "Alt" && inspecting) {
      alt = event.type === "keydown";
      draw();
    }
    if ((playing || inspecting) && event.type === "keydown" && ["Escape", "ArrowLeft", "ArrowRight", "r", "R", "Backspace"].indexOf(event.key) !== -1) {
      event.preventDefault();
      parent.postMessage({ type: "sb-key", key: event.key }, "*");
    }
  }
  document.addEventListener("screenbook:redraw", draw);
  document.addEventListener("keydown", key, true);
  document.addEventListener("keyup", key, true);
  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "sb-inspect") {
      inspecting = !!data.on;
      if (!inspecting) { selected = null; hovered = null; }
      document.documentElement.style.cursor = inspecting ? "default" : "";
      draw();
    }
    if (data.type === "sb-inspect-alt") {
      alt = !!data.on;
      draw();
    }
    if (data.type === "sb-inspect-depth" && selected) {
      var chain = pathOf(selected);
      var node = chain[data.depth];
      if (node) pick(node);
    }
    if (data.type === "sb-inspect-parent" && selected && selected.parentElement && selected.parentElement !== document.documentElement) pick(selected.parentElement);
    if (data.type === "sb-inspect-clear") pick(null);
    if (data.type === "sb-inspect-at") {
      var found = document.body;
      (Array.isArray(data.at) ? data.at : [null]).forEach(function (index) { found = found && typeof index === "number" ? found.children[index] : null; });
      pick(found && found !== document.body && own(found) ? found : null);
    }
    if (data.type === "sb-styles") parent.postMessage({ type: "sb-styles", id: data.id, styles: styles() }, "*");
    if (data.type === "sb-highlight") {
      if (data.color || data.font) highlight({ color: data.color, font: data.font });
      else draw();
    }
    if (data.type === "sb-play") {
      playing = !!data.on;
      hotspots = (data.hotspots || []).filter(function (name) { return typeof name === "string"; });
      if (playing && data.flash) setTimeout(flashHotspots, 250);
    }
    if (data.type === "sb-play-flash") flashHotspots();
  });
  parent.postMessage({ type: "sb-ready" }, "*");
})();
</script>`;
