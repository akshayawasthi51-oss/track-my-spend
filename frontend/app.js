const inr = n => "₹" + Number(n).toLocaleString("en-IN");

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c])
);

const $ = id => document.getElementById(id);
const month = new Date().toISOString().slice(0, 7);

let goalsCache = [];

async function api(path, opts) {
  const r = await fetch("/api" + path, opts);
  const text = await r.text();

  let data = {};

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Server returned an invalid response.");
    }
  }

  if (!r.ok) {
    console.error("API Error Response:", text);
    throw new Error(data.error || data.message || text || "Request failed");
  }

  return data;
}

const post = (path, body) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// ===== Toast popup =====
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add("show"));

  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, 3500);
}

// ===== Quick action buttons =====
function goTo(sectionId, focusEl) {
  $(sectionId).scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  setTimeout(() => focusEl.focus(), 400);
}

$("btnExpense").addEventListener("click", () => {
  const f = $("txForm");
  f.elements["type"].value = "Expense";

  goTo("txSection", f.elements["description"]);
});

$("btnIncome").addEventListener("click", async () => {
  const amountText = prompt("Income amount (₹):");

  if (amountText === null) return;

  const amount = parseFloat(amountText);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Please enter a valid amount greater than 0.");
    return;
  }

  const description =
    (prompt("Description:", "Salary") || "").trim() || "Salary";

  const today = new Date();

  const date = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  try {
    await post("/transactions", {
      description,
      amount,
      category: "Income",
      type: "Income",
      date
    });

    await refresh();
    toast("✅ Income added: " + inr(amount));
  } catch (err) {
    alert(err.message);
  }
});

$("btnGoal").addEventListener("click", () => {
  goTo("goalSection", $("goalForm").elements["name"]);
});

// ===== Update / Reset Monthly Budget =====
async function openBudgetModal() {
  const newBudget = prompt("Enter new monthly budget (e.g., 30000):", "30000");
  if (newBudget === null) return;

  const parsedBudget = parseFloat(newBudget);
  if (isNaN(parsedBudget) || parsedBudget < 0) {
    alert("Please enter a valid positive number!");
    return;
  }

  try {
    await post("/budget", { budget: parsedBudget });
    alert("Budget updated successfully!");
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

// ===== Transactions + summary =====
async function refresh() {
  const [s, tx] = await Promise.all([
    api("/summary?month=" + month),
    api("/transactions")
  ]);

  $("totalIncome").textContent = inr(s.income);
  $("totalExpenses").textContent = inr(s.expenses);
  $("totalSavings").textContent = inr(s.savings);
  $("balance").textContent = inr(s.balance);

  $("surplus").textContent =
    (s.balance >= 0 ? "Surplus: " : "Deficit: ") +
    inr(Math.abs(s.balance));

  $("budgetTotal").textContent = inr(s.budget);
  $("budgetExpenses").textContent = inr(s.expenses);
  $("budgetRemaining").textContent = inr(s.remaining);

  $("budgetStatus").textContent =
    s.remaining >= 0 ? "Within Budget" : "Over Budget";

  $("budgetPct").textContent = Math.round(s.usagePct) + "%";

  $("budgetBar").style.width =
    Math.min(s.usagePct, 100) + "%";

  $("budgetUsedText").textContent =
    inr(s.expenses) + " of " + inr(s.budget) + " used";

  document.querySelectorAll("[data-cat]").forEach(el => {
    el.textContent = inr(s.byCategory[el.dataset.cat] || 0);
  });

  $("topCategory").textContent = s.topCategory || "—";
  $("topAmount").textContent = inr(s.topAmount);
  $("savingsRate").textContent = Math.round(s.savingsRate) + "%";

  $("savingsText").textContent =
    inr(s.savings) + " saved this month";

  $("dailyAvg").textContent = inr(Math.round(s.dailyAvg));

  $("insightStatus").textContent =
    s.remaining >= 0 ? "Within Budget" : "Over Budget";

  $("insightRemaining").textContent =
    s.remaining >= 0
      ? inr(s.remaining) + " remaining"
      : inr(Math.abs(s.remaining)) + " over budget";

  tx.sort((a, b) =>
    b.date.localeCompare(a.date) || b.id - a.id
  );

  $("txBody").innerHTML = tx.slice(0, 10).map(t => `
    <tr>
      <td>${new Date(t.date + "T00:00:00").toLocaleDateString(
        "en-GB",
        { day: "2-digit", month: "short" }
      )}</td>
      <td>${esc(t.description)}</td>
      <td>${esc(t.category)}</td>
      <td>${esc(t.type)}</td>
      <td>${inr(t.amount)}</td>
      <td>
        <button type="button" class="del-tx" data-id="${t.id}">
          Delete
        </button>
      </td>
    </tr>
  `).join("");
}

$("txForm").addEventListener("submit", async e => {
  e.preventDefault();

  const fd = new FormData(e.target);

  try {
    await post("/transactions", {
      description: String(fd.get("description")).trim(),
      amount: parseFloat(fd.get("amount")),
      category: fd.get("category"),
      type: fd.get("type"),
      date: fd.get("date")
    });

    e.target.reset();
    await refresh();
    toast("Transaction added successfully.");
  } catch (err) {
    alert(err.message);
  }
});

// ===== Delete a transaction =====
document.addEventListener("click", async e => {
  const button = e.target.closest(".del-tx");

  if (!button) return;

  if (!confirm("Delete this transaction? This cannot be undone.")) {
    return;
  }

  button.disabled = true;

  try {
    await api("/transactions/" + button.dataset.id, {
      method: "DELETE"
    });

    await refresh();
    toast("Transaction deleted.");
  } catch (err) {
    button.disabled = false;
    alert(err.message);
  }
});

// ===== Savings goals =====
async function refreshGoals() {
  const goals = await api("/goals");
  goalsCache = goals;

  const card = g => {
    const done = Number(g.saved) >= Number(g.target);

    const pct = Math.min(
      100,
      (Number(g.saved) / Number(g.target)) * 100
    );

    const left = Math.max(
      0,
      Number(g.target) - Number(g.saved)
    );

    return `
      <div class="saving-card ${done ? "goal-done" : ""}">
        <div class="saving-info">
          <h4>${esc(g.name)}</h4>
          <p>Saved: ${inr(g.saved)} / ${inr(g.target)}</p>
        </div>

        <div class="progress-bar">
          <div class="progress" style="width: ${pct}%;"></div>
        </div>

        <p class="remaining">Remaining: ${inr(left)}</p>

        <div class="goal-actions">
          ${done
            ? `<span class="goal-badge">✅ Goal completed</span>`
            : `<button
                   type="button"
                   class="add-money"
                   data-id="${g.id}">
                   + Add money
                 </button>`
          }

          <button
            type="button"
            class="delete-goal"
            data-id="${g.id}">
            Delete
          </button>
        </div>
      </div>
    `;
  };

  const large = goals.filter(g => g.tier === "large");
  const small = goals.filter(g => g.tier !== "large");

  const sum = arr =>
    arr.reduce((total, g) => total + Number(g.saved), 0);

  $("largeGoals").innerHTML =
    large.map(card).join("") || "<p>No goals yet.</p>";

  $("smallGoals").innerHTML =
    small.map(card).join("") || "<p>No goals yet.</p>";

  $("goalsTotalSaved").textContent = inr(sum(goals));
  $("goalsLargeSaved").textContent = inr(sum(large));
  $("goalsSmallSaved").textContent = inr(sum(small));
}

// ===== Create a savings goal =====
$("goalForm").addEventListener("submit", async e => {
  e.preventDefault();

  const fd = new FormData(e.target);

  const name = String(fd.get("name")).trim();
  const target = Number(fd.get("target"));
  const saved = Number(fd.get("saved")) || 0;

  try {
    await post("/goals", {
      name,
      target,
      saved,
      tier: fd.get("tier")
    });

    e.target.reset();

    await refreshGoals();

    if (saved >= target) {
      toast("🎉 Goal completed: " + name + "!");
    } else {
      toast("Savings goal added: " + name);
    }
  } catch (err) {
    alert(err.message);
  }
});

// ===== Add money to a goal =====
document.addEventListener("click", async e => {
  const button = e.target.closest(".add-money");

  if (!button) return;

  const id = Number(button.dataset.id);
  const goal = goalsCache.find(g => Number(g.id) === id);

  if (!goal) return;

  const left = Number(goal.target) - Number(goal.saved);

  const amountText = prompt(
    "How much do you want to add? (₹)\n" +
    "Remaining for this goal: " + inr(left)
  );

  if (amountText === null) return;

  const amount = Number(amountText);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Please enter a valid amount greater than 0.");
    return;
  }

  if (amount > left) {
    alert(
      "That is more than the remaining " + inr(left) +
      ". Please enter " + inr(left) + " or less."
    );
    return;
  }

  button.disabled = true;

  try {
    await post("/goals/" + id + "/add", { amount });

    await refreshGoals();

    if (Number(goal.saved) + amount >= Number(goal.target)) {
      toast("🎉 Goal completed: " + goal.name + "!");
    } else {
      toast("Money added to " + goal.name + ".");
    }
  } catch (err) {
    button.disabled = false;
    alert(err.message);
  }
});

// ===== Delete a savings goal =====
document.addEventListener("click", async e => {
  const button = e.target.closest(".delete-goal");

  if (!button) return;

  const id = Number(button.dataset.id);
  const goal = goalsCache.find(g => Number(g.id) === id);

  if (!goal) {
    alert("Goal not found. Please refresh the page.");
    return;
  }

  const confirmed = confirm(
    'Are you sure you want to delete "' + goal.name + '"?\n\n' +
    "Its saved amount and progress will be removed permanently. " +
    "This action cannot be undone."
  );

  if (!confirmed) return;

  button.disabled = true;

  try {
    await api("/goals/" + id, {
      method: "DELETE"
    });

    await refreshGoals();
    toast('Goal "' + goal.name + '" deleted.');
  } catch (err) {
    button.disabled = false;
    alert(err.message);
  }
});

// ===== Start =====
refresh().catch(err => {
  console.error("refresh failed:", err);
  toast("Could not load transactions. Check the server.");
});

refreshGoals().catch(err => {
  console.error("goals failed:", err);
  toast("Could not load savings goals. Check the server.");
});