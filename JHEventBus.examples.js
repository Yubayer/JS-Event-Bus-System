// ============================================================
//  JHEventBus — Real-World Example Use Cases
//  Assumes JHEventBus.js is already loaded / imported
// ============================================================

const bus = new JHEventBus({ verbose: true });


// ════════════════════════════════════════════════════════════
// 1. BASIC — Simple data passing
// ════════════════════════════════════════════════════════════

bus.on("greet", (data) => {
  console.log(`Hello, ${data.name}! You are ${data.age} years old.`);
});

bus.emit("greet", { name: "Rahim", age: 25 });
// → Hello, Rahim! You are 25 years old.


// ════════════════════════════════════════════════════════════
// 2. USER AUTH — Login / Logout flow
// ════════════════════════════════════════════════════════════

bus.on("user:login", (user) => {
  console.log(`✅ Logged in: ${user.email}`);
  localStorage.setItem("session", JSON.stringify(user));
});

bus.on("user:logout", () => {
  localStorage.removeItem("session");
  console.log("🚪 Logged out. Session cleared.");
});

// Emit login
bus.emit("user:login", {
  id: 101,
  email: "rahim@example.com",
  role: "admin",
  token: "jwt_abc123",
});

// Later, emit logout
bus.emit("user:logout");


// ════════════════════════════════════════════════════════════
// 3. ASYNC HANDLER — API call inside listener
// ════════════════════════════════════════════════════════════

bus.on(
  "product:fetch",
  async (data) => {
    const res = await fetch(`/api/products/${data.id}`);
    const product = await res.json();
    console.log("📦 Product fetched:", product.name);
  },
  { type: "async" }
);

// Emit and wait for the async listener to finish
await bus.emit("product:fetch", { id: 42 }, { mode: "sync" });
console.log("✅ product:fetch fully complete");


// ════════════════════════════════════════════════════════════
// 4. PRIORITY — Order of execution control
// ════════════════════════════════════════════════════════════

bus.on("order:place", (order) => console.log("3️⃣ Send confirmation email"), { priority: 1 });
bus.on("order:place", (order) => console.log("1️⃣ Validate stock"),          { priority: 100 });
bus.on("order:place", (order) => console.log("2️⃣ Charge payment"),          { priority: 50 });

bus.emit("order:place", { orderId: "ORD-999", total: 1500 });
// → 1️⃣ Validate stock
// → 2️⃣ Charge payment
// → 3️⃣ Send confirmation email


// ════════════════════════════════════════════════════════════
// 5. ONCE — Fire only one time (e.g. app init)
// ════════════════════════════════════════════════════════════

bus.once("app:init", (config) => {
  console.log("🚀 App initialized with config:", config);
});

bus.emit("app:init", { theme: "dark", lang: "bn", version: "2.0.0" });
// → fires ✅

bus.emit("app:init", { theme: "light" });
// → nothing happens — already removed


// ════════════════════════════════════════════════════════════
// 6. ONCE — Cancel before it fires (early off)
// ════════════════════════════════════════════════════════════

const onboardingHandler = (data) => {
  console.log("🎉 Show onboarding tour for:", data.userId);
};

bus.once("user:firstVisit", onboardingHandler);

// User navigated away — cancel before it fires
bus.off("user:firstVisit", onboardingHandler);

bus.emit("user:firstVisit", { userId: 7 });
// → nothing happens — cancelled cleanly


// ════════════════════════════════════════════════════════════
// 7. WILDCARD "*" — Catch ALL events (logging / analytics)
// ════════════════════════════════════════════════════════════

bus.on("*", (data, event) => {
  console.log(`[Analytics] Event fired: "${event}"`, data);
});

bus.emit("cart:add",    { productId: 5, qty: 2 });
bus.emit("cart:remove", { productId: 5 });
bus.emit("checkout",    { total: 4500 });
// All 3 are caught by the wildcard listener


// ════════════════════════════════════════════════════════════
// 8. MIDDLEWARE — Logging every event globally
// ════════════════════════════════════════════════════════════

bus.use((event, data) => {
  console.log(`[LOG] ${new Date().toISOString()} | Event: "${event}" | Data:`, data);
});

// All subsequent emits will be logged automatically
bus.emit("user:login", { email: "karim@example.com", role: "user" });


// ════════════════════════════════════════════════════════════
// 9. MIDDLEWARE — Auth guard (block unauthorized events)
// ════════════════════════════════════════════════════════════

const PROTECTED_EVENTS = ["admin:deleteUser", "admin:ban"];

bus.use((event, data) => {
  if (PROTECTED_EVENTS.includes(event)) {
    const session = JSON.parse(localStorage.getItem("session") || "{}");
    if (session.role !== "admin") {
      throw new Error(`🔒 Unauthorized: "${event}" requires admin role.`);
    }
  }
});

// If current user is not admin, the error is caught per-listener
// and logged — other listeners are unaffected
bus.emit("admin:deleteUser", { targetId: 55 });


// ════════════════════════════════════════════════════════════
// 10. DEBOUNCE — Search input (fires only after user stops typing)
// ════════════════════════════════════════════════════════════

const stopSearchListener = bus.debounce(
  "search:query",
  (data) => {
    console.log(`🔍 Searching for: "${data.query}"`);
    // fetch(`/api/search?q=${data.query}`)
  },
  400 // wait 400ms after last keystroke
);

// Simulate rapid keystrokes
bus.emit("search:query", { query: "s" });
bus.emit("search:query", { query: "sh" });
bus.emit("search:query", { query: "shi" });
bus.emit("search:query", { query: "shirt" });
// → Only fires once: 🔍 Searching for: "shirt"

// Later, remove the debounced listener
stopSearchListener();


// ════════════════════════════════════════════════════════════
// 11. THROTTLE — Scroll / resize / mouse tracking
// ════════════════════════════════════════════════════════════

const stopScrollListener = bus.throttle(
  "window:scroll",
  (data) => {
    console.log(`📜 Scroll position: Y=${data.scrollY}`);
  },
  200 // max once per 200ms
);

window.addEventListener("scroll", () => {
  bus.emit("window:scroll", { scrollY: window.scrollY });
});

// Remove when component unmounts
// stopScrollListener();


// ════════════════════════════════════════════════════════════
// 12. COMPONENT COMMUNICATION — Without prop drilling
//     (React / Vanilla JS pattern)
// ════════════════════════════════════════════════════════════

// --- CartIcon Component ---
bus.on("cart:updated", (cart) => {
  document.querySelector("#cart-count").textContent = cart.totalItems;
});

// --- ProductCard Component ---
function addToCart(product) {
  const cart = {
    items: [product],
    totalItems: 1,
    totalPrice: product.price,
  };
  bus.emit("cart:updated", cart);
}

addToCart({ id: 9, name: "Classic T-Shirt", price: 850 });
// → CartIcon updates automatically, no prop drilling needed


// ════════════════════════════════════════════════════════════
// 13. FORM SUBMIT — Multi-step data collection
// ════════════════════════════════════════════════════════════

const formData = {};

bus.on("form:step1", (data) => Object.assign(formData, data));
bus.on("form:step2", (data) => Object.assign(formData, data));
bus.on("form:submit", async () => {
  console.log("📨 Submitting full form:", formData);
  // await fetch("/api/submit", { method: "POST", body: JSON.stringify(formData) });
});

bus.emit("form:step1", { name: "Karim", email: "karim@test.com" });
bus.emit("form:step2", { address: "Khulna, BD", zip: "9100" });
bus.emit("form:submit");
// → 📨 Submitting full form: { name, email, address, zip }


// ════════════════════════════════════════════════════════════
// 14. INSPECTION — Debug who is listening
// ════════════════════════════════════════════════════════════

console.log("Active events:", bus.eventNames());
// → ["greet", "user:login", "cart:updated", ...]

console.log("Listeners on cart:updated:", bus.listenerCount("cart:updated"));
// → 1

console.log("Has listeners for payment:fail?", bus.hasListeners("payment:fail"));
// → false


// ════════════════════════════════════════════════════════════
// 15. CLEANUP — Component unmount / page teardown
// ════════════════════════════════════════════════════════════

// Remove one specific event
bus.clear("window:scroll");

// Remove ALL events (full reset, e.g. on page navigation)
bus.clear();

// Full destroy (middlewares also wiped)
bus.destroy();
