#include "httplib.h"
#include "json.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <ctime>
#include <string>
#include <cstdlib>

using json = nlohmann::json;

const std::string DATA_FILE = "data/data.json";
std::mutex mtx;
json db;

void load() {
    std::ifstream f(DATA_FILE);
    if (f) {
        try {
            f >> db;
        } catch (...) {
            db = json::object();
        }
    }
    if (!db.is_object()) db = json::object();
    if (!db.contains("transactions") || !db["transactions"].is_array())
        db["transactions"] = json::array();
    if (!db.contains("goals") || !db["goals"].is_array())
        db["goals"] = json::array();
    if (!db.contains("nextId") || !db["nextId"].is_number_integer())
        db["nextId"] = 1;
    if (!db.contains("budget") || !db["budget"].is_number())
        db["budget"] = 30000.0;
}

void save() {
    std::ofstream f(DATA_FILE);
    if (f) {
        f << db.dump(2);
    } else {
        std::cerr << "ERROR: Could not write " << DATA_FILE << '\n';
    }
}

int nextId() {
    int id = db["nextId"].get<int>();
    db["nextId"] = id + 1;
    return id;
}

void err(httplib::Response& res, int code, const std::string& msg) {
    res.status = code;
    res.set_content(json{{"error", msg}}.dump(), "application/json");
}

json summary(const std::string& month) {
    double income = 0, expenses = 0, savings = 0;
    std::map<std::string, double> cat;

    for (const auto& t : db["transactions"]) {
        std::string d = t.value("date", "");
        if (!month.empty() && d.rfind(month, 0) != 0) continue;
        double a = t.value("amount", 0.0);
        std::string type = t.value("type", "");

        if (type == "Income") {
            income += a;
        } else if (type == "Savings") {
            savings += a;
        } else {
            expenses += a;
            cat[t.value("category", "Miscellaneous")] += a;
        }
    }

    double budget = db.value("budget", 30000.0);
    std::string top;
    double topAmt = 0;
    for (const auto& [k, v] : cat) {
        if (v > topAmt) {
            topAmt = v;
            top = k;
        }
    }

    std::time_t now = std::time(nullptr);
    std::tm* local = std::localtime(&now);
    int days = local ? local->tm_mday : 1;

    return {
        {"income", income},
        {"expenses", expenses},
        {"savings", savings},
        {"balance", income - expenses - savings},
        {"budget", budget},
        {"remaining", budget - expenses},
        {"usagePct", budget > 0 ? expenses / budget * 100 : 0},
        {"byCategory", cat},
        {"topCategory", top},
        {"topAmount", topAmt},
        {"savingsRate", income > 0 ? savings / income * 100 : 0},
        {"dailyAvg", days > 0 ? expenses / days : 0}
    };
}

int main() {
    std::filesystem::create_directories("data");
    load();

    httplib::Server svr;
    svr.set_default_headers({
    {"Access-Control-Allow-Origin", "*"},
    {"Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"},
    {"Access-Control-Allow-Headers", "Content-Type"}
});

svr.Options(R"(/api.*)", [](const httplib::Request& req, httplib::Response& res) {
    res.status = 204;
});

    // Frontend static files mount
    svr.set_mount_point("/", "../frontend");

    svr.set_logger([](const httplib::Request& req, const httplib::Response& res) {
        std::cout << req.method << " " << req.path << " -> " << res.status << std::endl;
    });

    // Summary endpoint
    svr.Get("/api/summary", [](const httplib::Request& req, httplib::Response& res) {
        std::string m = req.get_param_value("month");
        std::lock_guard<std::mutex> lock(mtx);
        res.set_content(summary(m).dump(), "application/json");
    });

    // Budget update / reset endpoint
    svr.Post("/api/budget", [](const httplib::Request& req, httplib::Response& res) {
        json b = json::parse(req.body, nullptr, false);
        if (b.is_discarded() || !b.is_object()) return err(res, 400, "Invalid JSON");

        double newBudget = b.value("budget", 30000.0);
        if (newBudget < 0) return err(res, 400, "Budget must be >= 0");

        std::lock_guard<std::mutex> lock(mtx);
        db["budget"] = newBudget;
        save();

        res.set_content(json{{"budget", newBudget}, {"ok", true}}.dump(), "application/json");
    });

    // Transactions: get all
    svr.Get("/api/transactions", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(mtx);
        res.set_content(db["transactions"].dump(), "application/json");
    });

    // Transactions: create
    svr.Post("/api/transactions", [](const httplib::Request& req, httplib::Response& res) {
        json b = json::parse(req.body, nullptr, false);
        if (b.is_discarded() || !b.is_object()) return err(res, 400, "Invalid JSON");
        try {
            std::string desc = b.at("description").get<std::string>();
            std::string cat = b.value("category", "Miscellaneous");
            std::string type = b.at("type").get<std::string>();
            std::string date = b.at("date").get<std::string>();
            double amount = b.at("amount").get<double>();

            if (desc.empty()) return err(res, 400, "Description required");
            if (amount <= 0) return err(res, 400, "Amount must be > 0");
            if (type != "Income" && type != "Expense" && type != "Savings")
                return err(res, 400, "Type must be Income, Expense or Savings");
            if (date.size() != 10) return err(res, 400, "Date must be YYYY-MM-DD");

            std::lock_guard<std::mutex> lock(mtx);
            json t = {
                {"id", nextId()},
                {"description", desc},
                {"category", cat},
                {"type", type},
                {"date", date},
                {"amount", amount}
            };
            db["transactions"].push_back(t);
            save();

            res.status = 201;
            res.set_content(t.dump(), "application/json");
        } catch (...) {
            err(res, 400, "Missing or invalid fields");
        }
    });

    // Transactions: delete
    svr.Delete(R"(/api/transactions/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        std::lock_guard<std::mutex> lock(mtx);
        auto& arr = db["transactions"];
        for (size_t i = 0; i < arr.size(); ++i) {
            if (arr[i].value("id", -1) == id) {
                arr.erase(arr.begin() + i);
                save();
                res.set_content(R"({"ok":true})", "application/json");
                return;
            }
        }
        err(res, 404, "Transaction not found");
    });

    // Savings goals: get all
    svr.Get("/api/goals", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(mtx);
        res.set_content(db["goals"].dump(), "application/json");
    });

    // Savings goals: create
    svr.Post("/api/goals", [](const httplib::Request& req, httplib::Response& res) {
        json b = json::parse(req.body, nullptr, false);
        if (b.is_discarded() || !b.is_object()) return err(res, 400, "Invalid JSON");
        try {
            std::string name = b.at("name").get<std::string>();
            double target = b.at("target").get<double>();
            double saved = b.value("saved", 0.0);
            std::string tier = b.value("tier", "small");

            if (name.empty()) return err(res, 400, "Goal name required");
            if (target <= 0) return err(res, 400, "Target must be > 0");

            std::lock_guard<std::mutex> lock(mtx);
            json g = {
                {"id", nextId()},
                {"name", name},
                {"target", target},
                {"saved", saved},
                {"tier", tier}
            };
            db["goals"].push_back(g);
            save();

            res.status = 201;
            res.set_content(g.dump(), "application/json");
        } catch (...) {
            err(res, 400, "Missing or invalid fields");
        }
    });

    // Savings goals: delete
    svr.Delete(R"(/api/goals/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        int id = 0;
        try {
            id = std::stoi(req.matches[1]);
        } catch (...) {
            return err(res, 400, "Invalid goal ID");
        }

        std::lock_guard<std::mutex> lock(mtx);
        auto& arr = db["goals"];
        for (size_t i = 0; i < arr.size(); ++i) {
            if (arr[i].value("id", -1) == id) {
                arr.erase(arr.begin() + i);
                save();
                res.set_content(R"({"ok":true})", "application/json");
                return;
            }
        }
        err(res, 404, "Goal not found");
    });

    // Savings goals: add money
    svr.Post(R"(/api/goals/(\d+)/add)", [](const httplib::Request& req, httplib::Response& res) {
        int id = 0;
        try {
            id = std::stoi(req.matches[1]);
        } catch (...) {
            return err(res, 400, "Invalid goal ID");
        }

        json b = json::parse(req.body, nullptr, false);
        if (b.is_discarded() || !b.is_object()) return err(res, 400, "Invalid JSON");

        double addAmount = b.value("amount", 0.0);
        if (addAmount <= 0) return err(res, 400, "Amount must be > 0");

        std::lock_guard<std::mutex> lock(mtx);
        auto& arr = db["goals"];
        for (auto& goal : arr) {
            if (goal.value("id", -1) == id) {
                double currentSaved = goal.value("saved", 0.0);
                goal["saved"] = currentSaved + addAmount;
                save();
                res.set_content(goal.dump(), "application/json");
                return;
            }
        }
        err(res, 404, "Goal not found");
    });

    std::cout << "Server started at http://localhost:8080\n";
   const char* port_env = std::getenv("PORT");
int port = port_env ? std::atoi(port_env) : 8080;
svr.listen("0.0.0.0", port);
    return 0;
}