cmake_minimum_required(VERSION 3.15)
project(lehra_server CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Compiler optimization and warning flags for production build
if(MSVC)
    add_compile_options(/W4 /O2 /EHsc)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -O3 -pthread)
endif()

# Find dependencies
find_package(Threads REQUIRED)
find_package(Drogon REQUIRED)
find_package(ZLIB REQUIRED)
find_package(OpenSSL REQUIRED)

include_directories(${CMAKE_CURRENT_SOURCE_DIR})

set(SOURCES
    main.cpp
    utils/Security.cpp
    utils/Subprocess.cpp
    utils/ZipUtils.cpp
    models/JobStore.cpp
    services/JobWorkerPool.cpp
    services/AudioProcessorService.cpp
    controllers/AudioController.cpp
    controllers/StemController.cpp
    controllers/StaticController.cpp
)

add_executable(${PROJECT_NAME} ${SOURCES})

target_link_libraries(${PROJECT_NAME} PRIVATE
    Drogon::Drogon
    Threads::Threads
    ZLIB::ZLIB
    OpenSSL::SSL
    OpenSSL::Crypto
)

if(NOT MSVC)
    target_link_libraries(${PROJECT_NAME} PRIVATE stdc++fs)
endif()
