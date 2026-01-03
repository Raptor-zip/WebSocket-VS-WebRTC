cmake_minimum_required(VERSION 3.14)
project(websocket_vs_webrtc_cpp)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# --- Dependencies ---

# 1. uWebSockets
set(LIBUS_USE_OPENSSL ON CACHE BOOL "" FORCE)
FetchContent_Declare(
    usockets
    GIT_REPOSITORY https://github.com/uNetworking/uSockets.git
    GIT_TAG        master
)
FetchContent_GetProperties(usockets)
if(NOT usockets_POPULATED)
    FetchContent_Populate(usockets)

    # Manually define uSockets library
    file(GLOB_RECURSE USOCKETS_SOURCES
        "${usockets_SOURCE_DIR}/src/*.c"
        "${usockets_SOURCE_DIR}/src/eventing/*.c"
        "${usockets_SOURCE_DIR}/src/crypto/*.cpp"
    )

    add_library(uSockets STATIC ${USOCKETS_SOURCES})
    target_compile_definitions(uSockets PUBLIC LIBUS_USE_OPENSSL)
    target_include_directories(uSockets PUBLIC "${usockets_SOURCE_DIR}/src")
    target_link_libraries(uSockets PRIVATE OpenSSL::SSL OpenSSL::Crypto)
endif()

FetchContent_Declare(
    uwebsockets
    GIT_REPOSITORY https://github.com/uNetworking/uWebSockets.git
    GIT_TAG        master
)
FetchContent_MakeAvailable(uwebsockets)

# 2. nlohmann/json (for signaling)
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.2
)
FetchContent_MakeAvailable(json)

# 3. libdatachannel
set(NO_WEBSOCKET ON CACHE BOOL "Disable WebSocket support in libdatachannel" FORCE)
set(NO_MEDIA ON CACHE BOOL "Disable Media support in libdatachannel" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "Disable examples" FORCE)
set(NO_TESTS ON CACHE BOOL "Disable tests" FORCE)

FetchContent_Declare(
    libdatachannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG        v0.18.4
)
FetchContent_MakeAvailable(libdatachannel)

# --- Executable ---

add_executable(server main.cpp)

# Libraries
target_link_libraries(server PRIVATE uSockets datachannel nlohmann_json::nlohmann_json)

# OpenSSL is usually required by uSockets/libdatachannel
find_package(OpenSSL REQUIRED)
target_link_libraries(server PRIVATE OpenSSL::SSL OpenSSL::Crypto)

# Threading
find_package(Threads REQUIRED)
target_link_libraries(server PRIVATE Threads::Threads)

# ZLIB (for uWebSockets compression)
find_package(ZLIB REQUIRED)
target_link_libraries(server PRIVATE ZLIB::ZLIB)

# Allow uWebSockets to use SSL
target_compile_definitions(server PRIVATE LIBUS_USE_OPENSSL)

# Include directories if needed (often handled by target_link_libraries)
target_include_directories(server PRIVATE
    ${uwebsockets_SOURCE_DIR}/src
    ${usockets_SOURCE_DIR}/src
)
