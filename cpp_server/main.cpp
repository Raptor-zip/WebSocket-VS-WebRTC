#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <chrono>

#include "App.h" // uWebSockets
#include "rtc/rtc.hpp" // libdatachannel
#include "nlohmann/json.hpp"
#include <thread>
#include <mutex>
#include <set>
#include <algorithm>

using json = nlohmann::json;

// --- Globals & Config ---
bool ENABLE_BACKPRESSURE = false;
const size_t BACKPRESSURE_THRESHOLD = 1024 * 32; // 32KB buffer limit

std::mutex stats_mutex;
std::set<uWS::WebSocket<true, true, int>*> active_ws;
std::set<std::shared_ptr<rtc::DataChannel>> active_dcs;

// Timer thread control
bool server_running = true;

// Helper for time
int64_t current_time_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

// Helper to read file content
std::string readFile(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return "";
    std::stringstream buffer;
    buffer << f.rdbuf();
    return buffer.str();
}

int main(int argc, char** argv) {
    // Parse Args
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--backpressure") {
            ENABLE_BACKPRESSURE = true;
            std::cout << "Backpressure Enabled (Threshold: " << BACKPRESSURE_THRESHOLD << " bytes)" << std::endl;
        }
    }

    // --- Setup WebRTC (libdatachannel) ---
    // Enable verbose logging to debug connection issues
    rtc::InitLogger(rtc::LogLevel::Debug);

    // Keep track of PeerConnections to prevent destruction
    // In a real app, manage lifetime properly (e.g. clean up on disconnect)
    // For this benchmark tool, we might let them leak or simple cleanup
    // But rtc::PeerConnection is shared_ptr based.
    // We'll use a simple list for now, or just let the closure capture keep it alive if possible?
    // rtc::PeerConnection objects are shared_from_this, so as long as callbacks hold them or we hold them.
    // Let's use a capture hack or a global map.
    // A simplified approach:

    // Actually, libdatachannel relies on shared_ptr. We can capture it in lambdas.

    // --- Setup uWebSockets ---
    // We need SSL
    uWS::SocketContextOptions ssl_options = {};
    ssl_options.key_file_name = "../key.pem";
    ssl_options.cert_file_name = "../cert.pem";
    // ssl_options.passphrase = "1234";

    uWS::SSLApp app(ssl_options);

    // 1. Static Files
    app.get("/", [](auto *res, auto *req) {
        std::string content = readFile("../static/index.html");
        res->writeHeader("Content-Type", "text/html")->end(content);
    });

    app.get("/client.js", [](auto *res, auto *req) {
        std::string content = readFile("../static/client.js");
        res->writeHeader("Content-Type", "application/javascript")->end(content);
    });

    // 2. WebSocket Echo
    app.ws<int>("/ws", {
        .compression = uWS::SHARED_COMPRESSOR,
        .maxPayloadLength = 16 * 1024 * 1024,
        .idleTimeout = 16, // Keep alive
        .maxBackpressure = 1 * 1024 * 1024,
        .closeOnBackpressureLimit = false,
        .resetIdleTimeoutOnSend = false,
        .sendPingsAutomatically = true,
        .open = [](auto *ws) {
            std::cout << "WS Connected" << std::endl;
            active_ws.insert(ws);
        },
        .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
            // Backpressure Check
            if (ENABLE_BACKPRESSURE && ws->getBufferedAmount() > BACKPRESSURE_THRESHOLD) {
                // Drop packet
                return;
            }

            try {
                auto data = json::parse(message);
                if (data["type"] == "ping") {
                    data["type"] = "pong";
                    data["client_ts"] = data["ts"];
                    data["server_ts"] = current_time_ms();
                    ws->send(data.dump(), opCode);
                }
            } catch (...) {}
        },
        .drain = [](auto *ws) {},
        .ping = [](auto *ws, std::string_view) {},
        .pong = [](auto *ws, std::string_view) {},
        .close = [](auto *ws, int code, std::string_view message) {
            std::cout << "WS Disconnected" << std::endl;
            active_ws.erase(ws);
        }
    });

    // 3. WebRTC Signaling (POST /offer)
    app.post("/offer", [](auto *res, auto *req) {
         // ... (existing code, unchanged by this block if I only target ws and end)
         // Wait, replace_file_content replaces range.
         // I should NOT include the POST handler in the replacement if I don't want to rewrite it.
         // But the `ws` block ends at line 136.
         // The `app.run` mess is at line 286.
         // They are far apart.
         // I should split this into TWO edits.
    });

    // ... (rest of main via separate chunk)

    // 3. WebRTC Signaling (POST /offer)
    app.post("/offer", [](auto *res, auto *req) {

        // Context for Thread Safety & Lifetime
        struct Context {
            bool aborted = false;
        };
        auto context = std::make_shared<Context>();

        // Attach abort handler IMMEDIATELY
        res->onAborted([context]() {
            context->aborted = true;
        });

        // Get Loop for thread dispatch
        auto *loop = uWS::Loop::get();

        // Read body
        res->onData([res, loop, context, bodyBuffer = std::string("")](std::string_view chunk, bool isLast) mutable {
             bodyBuffer.append(chunk);
             if (isLast) {
                 if (context->aborted) return;

                 try {
                     auto body_json = json::parse(bodyBuffer);
                     std::string sdp = body_json["sdp"];
                     std::string type = body_json["type"];

                     // Create PeerConnection
                     rtc::Configuration config;
                     // Enable/Disable Trickle ICE?
                     // config.iceServers.emplace_back("stun:stun.l.google.com:19302");

                     auto pc = std::make_shared<rtc::PeerConnection>(config);

                     pc->onStateChange([](rtc::PeerConnection::State state) {
                         // std::cout << "State: " << state << std::endl;
                     });

                     pc->onDataChannel([](std::shared_ptr<rtc::DataChannel> dc) {
                         // Track DC
                         {
                             std::lock_guard<std::mutex> lock(stats_mutex);
                             active_dcs.insert(dc);
                         }

                         dc->onClosed([dc]() {
                             std::lock_guard<std::mutex> lock(stats_mutex);
                             active_dcs.erase(dc);
                         });

                         dc->onMessage([dc](auto data) {
                             // Backpressure Check
                             if (ENABLE_BACKPRESSURE && dc->bufferedAmount() > BACKPRESSURE_THRESHOLD) {
                                 return; // Drop
                             }

                             if (std::holds_alternative<std::string>(data)) {
                                 std::string msg = std::get<std::string>(data);
                                 try {
                                     auto j = json::parse(msg);
                                     if (j["type"] == "ping") {
                                         j["type"] = "pong";
                                         j["client_ts"] = j["ts"]; // Map for client compatibility
                                         j["server_ts"] = current_time_ms();
                                         dc->send(j.dump());
                                     }
                                 } catch (...) {}
                             }
                         });
                     });

                     // Handle gathering on generic thread -> dispatch to loop
                     pc->onGatheringStateChange([res, pc, context, loop](rtc::PeerConnection::GatheringState state) {
                         if (state == rtc::PeerConnection::GatheringState::Complete) {
                             // Dispatch to main thread
                             loop->defer([res, pc, context]() {
                                 if (context->aborted) return;

                                 if (auto desc = pc->localDescription()) {
                                     json j;
                                     j["sdp"] = std::string(*desc);
                                     j["type"] = desc->typeString();
                                     res->writeHeader("Content-Type", "application/json")->end(j.dump());
                                 }
                             });
                         }
                     });

                     pc->onLocalDescription([](rtc::Description desc) {
                         std::cout << "Local Description set (gathering continuing...)" << std::endl;
                     });

                     pc->setRemoteDescription(rtc::Description(sdp, type));

                     if (type == "offer") {
                          pc->setLocalDescription();
                     }

                     // Keeper
                     static std::vector<std::shared_ptr<rtc::PeerConnection>> pc_keeper;
                     pc_keeper.push_back(pc);

                 } catch (const std::exception& e) {
                     // Could dispatch error?
                     std::cout << "Error: " << e.what() << std::endl;
                 }
             }
        });
    });

    std::cout << "Running C++ Server on port 8080..." << std::endl;

    // Logging Thread
    std::thread stats_thread([loop = uWS::Loop::get()]() {
        while (server_running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));

            // Defer to main loop for safe access
            loop->defer([]() {
                // WS (Single thread access safe here)
                size_t ws_buffered = 0;
                size_t ws_count = 0;
                for(auto* ws : active_ws) {
                    ws_buffered += ws->getBufferedAmount();
                    ws_count++;
                }

                // RTC (Mutex protected)
                size_t rtc_buffered = 0;
                size_t rtc_count = 0;
                {
                    std::lock_guard<std::mutex> lock(stats_mutex);
                    for(auto& dc : active_dcs) {
                         rtc_buffered += dc->bufferedAmount();
                         rtc_count++;
                    }
                }

                if (ws_count > 0 || rtc_count > 0) {
                     std::cout << "[Stats] Buffered - WS(" << ws_count << "): " << ws_buffered
                               << "b, RTC(" << rtc_count << "): " << rtc_buffered << "b" << std::endl;
                }
            });
        }
    });
    stats_thread.detach();

    app.listen(8080, [](auto *listen_socket) {
        if (listen_socket) {
            std::cout << "Listening on port 8080" << std::endl;
        } else {
            std::cerr << "Failed to listen on port 8080" << std::endl;
        }
    }).run();

    return 0;
}
