cmake_minimum_required(VERSION 3.16)
project(opensim_muscle_web LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenSim REQUIRED)

add_executable(muscle_web main.cpp)
target_include_directories(muscle_web PRIVATE ${OpenSim_INCLUDE_DIRS})
target_link_libraries(muscle_web PRIVATE ${OpenSim_LIBRARIES})
target_compile_definitions(muscle_web PRIVATE OPENSIM_SOURCE_TAG="4.6")

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(muscle_web PRIVATE -Wall -Wextra -Wpedantic)
endif()

set_target_properties(muscle_web PROPERTIES
    BUILD_RPATH "/opt/opensim/sdk/lib;/opt/opensim/sdk/Simbody/lib;/opt/opensim-dependencies/simbody/lib;/opt/opensim-dependencies/ezc3d/lib"
)
