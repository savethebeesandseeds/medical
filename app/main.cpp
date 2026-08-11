#include <OpenSim/OpenSim.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace {

constexpr const char* kModelName = "MoBL-ARMS Dynamic Upper Limb";
constexpr const char* kModelId = "MOBL_ARMS_41";
constexpr const char* kModelSha256 =
    "8BF1C3F0DB841DEFAACA2B906DED154A2B1700531B96B491AAB3DBC9A7343289";
constexpr const char* kArchiveSha256 =
    "7C61AFAC1F43B089F2659EAE7E5F7029FBB6BFFD6F09272B97A128A6D819F351";
constexpr const char* kSourceUrl = "https://simtk.org/projects/upexdyn";
constexpr const char* kModelPath =
    "/workspace/models/mobl_arms/MOBL_ARMS_41.osim";
constexpr const char* kGeometryPath =
    "/workspace/public/models/mobl_arms/Geometry";
constexpr const char* kBenchmarkPath =
    "/workspace/models/mobl_arms/benchmark/CMC_results_states.sto";
constexpr const char* kBenchmarkId = "CMC_REACH8_STATES";
constexpr const char* kBenchmarkName = "Author-supplied CMC Reach8 example";
constexpr const char* kBenchmarkSha256 =
    "58AD4A51E10BE4956207799106E63B3CEC689D39D7702A2318C3AE0E50089004";

// Static holding uses coordinate actuators only as bounded feasibility slacks.
// Parameterize each reserve as 0.5 Nm*z, z in [-1,1], but weight z by 625 so
// its quadratic cost remains exactly equivalent to a 0.02 Nm/control reserve.
// The physical capacity remains +/-0.5 Nm; usability is gated much earlier.
constexpr double kStaticReserveOptimalForceNm = 0.5;
constexpr double kStaticReserveControlLimit = 1.0;
constexpr double kStaticReserveObjectiveWeight = 625.0;
constexpr double kStaticReserveTorqueLimitNm = 0.05;
constexpr double kStaticCapacityLimitedReserveThresholdNm = 0.01;
constexpr double kStaticMuscleCapacityThreshold = 0.995;
constexpr double kStaticEquilibriumResidualLimit = 1.0e-4;
constexpr double kStaticAssemblyToleranceDegrees = 1.0e-3;
constexpr double kStaticInputRangeToleranceDegrees = 1.0e-6;
constexpr int kStaticMaximumIterations = 100;
constexpr double kStaticMaximumCpuSeconds = 5.0;

std::atomic<bool> g_running{true};

struct CoordinateSpec {
    const char* name;
    const char* label;
    const char* benchmarkColumn;
};

constexpr std::array<CoordinateSpec, 7> kPoseCoordinates{{
    {"elv_angle", "Plane of shoulder elevation",
     "/jointset/shoulder0/elv_angle/value"},
    {"shoulder_elv", "Shoulder elevation",
     "/jointset/shoulder1/shoulder_elv/value"},
    {"shoulder_rot", "Shoulder axial rotation",
     "/jointset/shoulder2/shoulder_rot/value"},
    {"elbow_flexion", "Elbow flexion",
     "/jointset/elbow/elbow_flexion/value"},
    {"pro_sup", "Forearm pronation / supination",
     "/jointset/radioulnar/pro_sup/value"},
    {"deviation", "Wrist deviation",
     "/jointset/radiocarpal/deviation/value"},
    {"flexion", "Wrist flexion",
     "/jointset/radiocarpal/flexion/value"},
}};

struct BenchmarkFrame {
    double time{0.0};
    std::array<double, kPoseCoordinates.size()> coordinateRadians{};
    std::vector<double> activations;
};

struct StaticHoldingResult {
    bool optimizerConverged{false};
    bool usable{false};
    std::string status{"not_run"};
    std::string reason{"Static holding optimization was not run"};
    std::string solverDetail;
    double durationMilliseconds{0.0};
    double objective{std::numeric_limits<double>::quiet_NaN()};
    double maximumAssemblyErrorDegrees{std::numeric_limits<double>::quiet_NaN()};
    double maximumAccelerationResidual{std::numeric_limits<double>::quiet_NaN()};
    double rmsAccelerationResidual{std::numeric_limits<double>::quiet_NaN()};
    double maximumOptimizerConstraintResidual{
        std::numeric_limits<double>::quiet_NaN()};
    double rmsOptimizerConstraintResidual{
        std::numeric_limits<double>::quiet_NaN()};
    double maximumReserveTorqueNm{std::numeric_limits<double>::quiet_NaN()};
    double rmsReserveTorqueNm{std::numeric_limits<double>::quiet_NaN()};
    int musclesAtLowerControlLimit{0};
    int musclesAtUpperControlLimit{0};
    int musclesAtOrAboveCapacityThreshold{0};
    int physicalLinearizations{0};
    int constraintMultipliers{0};
    std::vector<double> activations;
    std::array<double, kPoseCoordinates.size()> reserveTorquesNm{};
    std::array<double, kPoseCoordinates.size()> accelerationResiduals{};
};

class BoundedStaticEquilibriumTarget final : public SimTK::OptimizerSystem {
public:
    BoundedStaticEquilibriumTarget(
            SimTK::Matrix accelerationMatrix,
            SimTK::Vector restingAcceleration,
            SimTK::Vector objectiveWeights)
        : accelerationMatrix_(std::move(accelerationMatrix)),
          restingAcceleration_(std::move(restingAcceleration)),
          objectiveWeights_(std::move(objectiveWeights)) {
        setNumParameters(accelerationMatrix_.ncol());
        setNumEqualityConstraints(accelerationMatrix_.nrow());
        setNumLinearEqualityConstraints(accelerationMatrix_.nrow());
    }

    int objectiveFunc(const SimTK::Vector& parameters, bool,
                      SimTK::Real& objective) const override {
        objective = 0.0;
        for (int index = 0; index < parameters.size(); ++index) {
            objective += objectiveWeights_[index] * parameters[index] *
                parameters[index];
        }
        return 0;
    }

    int gradientFunc(const SimTK::Vector& parameters, bool,
                     SimTK::Vector& gradient) const override {
        for (int index = 0; index < parameters.size(); ++index) {
            gradient[index] = 2.0 * objectiveWeights_[index] *
                parameters[index];
        }
        return 0;
    }

    int constraintFunc(const SimTK::Vector& parameters, bool,
                       SimTK::Vector& constraints) const override {
        constraints = accelerationMatrix_ * parameters +
            restingAcceleration_;
        return 0;
    }

    int constraintJacobian(const SimTK::Vector&, bool,
                           SimTK::Matrix& jacobian) const override {
        jacobian = accelerationMatrix_;
        return 0;
    }

private:
    SimTK::Matrix accelerationMatrix_;
    SimTK::Vector restingAcceleration_;
    SimTK::Vector objectiveWeights_;
};

struct HttpResponse {
    int status{200};
    std::string reason{"OK"};
    std::string contentType{"application/json; charset=utf-8"};
    std::string body;
};

std::string jsonEscape(std::string_view input) {
    std::ostringstream output;
    for (const unsigned char character : input) {
        switch (character) {
            case '\\': output << "\\\\"; break;
            case '"': output << "\\\""; break;
            case '\n': output << "\\n"; break;
            case '\r': output << "\\r"; break;
            case '\t': output << "\\t"; break;
            default:
                if (character < 0x20) {
                    output << "\\u" << std::hex << std::setw(4)
                           << std::setfill('0') << static_cast<int>(character)
                           << std::dec << std::setfill(' ');
                } else {
                    output << static_cast<char>(character);
                }
        }
    }
    return output.str();
}

void appendNumber(std::ostringstream& output, double value) {
    if (std::isfinite(value)) {
        output << std::fixed << std::setprecision(8) << value;
    } else {
        output << "null";
    }
}

void appendVec3(std::ostringstream& output, const SimTK::Vec3& value) {
    output << '[';
    appendNumber(output, value[0]);
    output << ',';
    appendNumber(output, value[1]);
    output << ',';
    appendNumber(output, value[2]);
    output << ']';
}

void appendRotation(std::ostringstream& output, const SimTK::Rotation& rotation) {
    const SimTK::Mat33 matrix = rotation.asMat33();
    output << '[';
    for (int row = 0; row < 3; ++row) {
        for (int column = 0; column < 3; ++column) {
            if (row != 0 || column != 0) output << ',';
            appendNumber(output, matrix(row, column));
        }
    }
    output << ']';
}

std::string urlDecode(std::string_view input) {
    std::string output;
    output.reserve(input.size());
    for (std::size_t index = 0; index < input.size(); ++index) {
        if (input[index] == '+' ) {
            output.push_back(' ');
        } else if (input[index] == '%' && index + 2 < input.size()) {
            const auto hexValue = [](char value) -> int {
                if (value >= '0' && value <= '9') return value - '0';
                if (value >= 'a' && value <= 'f') return value - 'a' + 10;
                if (value >= 'A' && value <= 'F') return value - 'A' + 10;
                return -1;
            };
            const int high = hexValue(input[index + 1]);
            const int low = hexValue(input[index + 2]);
            if (high >= 0 && low >= 0) {
                output.push_back(static_cast<char>((high << 4) | low));
                index += 2;
            } else {
                output.push_back(input[index]);
            }
        } else {
            output.push_back(input[index]);
        }
    }
    return output;
}

std::map<std::string, std::string> parseQuery(std::string_view text) {
    std::map<std::string, std::string> values;
    std::size_t start = 0;
    while (start < text.size()) {
        const std::size_t end = text.find('&', start);
        const std::string_view part = text.substr(
            start, end == std::string_view::npos ? text.size() - start : end - start);
        const std::size_t equals = part.find('=');
        if (equals == std::string_view::npos) {
            if (!part.empty()) values[urlDecode(part)] = "";
        } else {
            values[urlDecode(part.substr(0, equals))] =
                urlDecode(part.substr(equals + 1));
        }
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
    return values;
}

std::optional<double> queryNumber(
        const std::map<std::string, std::string>& query,
        const std::string& key) {
    const auto found = query.find(key);
    if (found == query.end()) return std::nullopt;
    try {
        std::size_t consumed = 0;
        const double value = std::stod(found->second, &consumed);
        if (consumed != found->second.size() || !std::isfinite(value)) {
            return std::nullopt;
        }
        return value;
    } catch (...) {
        return std::nullopt;
    }
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw std::runtime_error("Unable to read " + path.string());
    std::ostringstream contents;
    contents << stream.rdbuf();
    return contents.str();
}

std::string mimeType(const std::filesystem::path& path) {
    const std::string extension = path.extension().string();
    if (extension == ".html") return "text/html; charset=utf-8";
    if (extension == ".js") return "text/javascript; charset=utf-8";
    if (extension == ".css") return "text/css; charset=utf-8";
    if (extension == ".svg") return "image/svg+xml";
    if (extension == ".vtp") return "application/xml; charset=utf-8";
    if (extension == ".txt" || extension == ".md") {
        return "text/plain; charset=utf-8";
    }
    return "application/octet-stream";
}

class ModelExplorer {
public:
    ModelExplorer(std::filesystem::path modelPath,
                  std::filesystem::path geometryPath,
                  std::filesystem::path benchmarkPath)
        : modelPath_(std::move(modelPath)),
          geometryPath_(std::move(geometryPath)),
          benchmarkPath_(std::move(benchmarkPath)) {
        if (!std::filesystem::exists(modelPath_)) {
            throw std::runtime_error("Official model is missing: " + modelPath_.string());
        }
        if (!std::filesystem::is_directory(geometryPath_)) {
            throw std::runtime_error(
                "Official geometry directory is missing: " + geometryPath_.string());
        }

        OpenSim::ModelVisualizer::addDirToGeometrySearchPaths(
            geometryPath_.string());
        model_ = std::make_unique<OpenSim::Model>(modelPath_.string());
        defaultState_ = model_->initSystem();
        state_ = defaultState_;
        loadBenchmark();
        initializeStaticHoldingModel();
        validatePackage();
    }

    int bodyCount() const { return model_->getBodySet().getSize(); }
    int coordinateCount() const { return model_->getCoordinateSet().getSize(); }
    int muscleCount() const { return model_->getMuscles().getSize(); }

    int meshCount() const {
        int count = 0;
        for (const auto& ignored : model_->getComponentList<OpenSim::Mesh>()) {
            static_cast<void>(ignored);
            ++count;
        }
        return count;
    }

    int ligamentCount() const {
        int count = 0;
        for (const auto& ignored : model_->getComponentList<OpenSim::Ligament>()) {
            static_cast<void>(ignored);
            ++count;
        }
        return count;
    }

    std::string healthJson() const {
        const char* gpu = std::getenv("MUSCLES_GPU");
        const std::string gpuName = gpu == nullptr ? "unavailable" : gpu;
        std::ostringstream output;
        output << "{\"status\":\"ok\",\"engine\":\"OpenSim C++ "
               << OPENSIM_SOURCE_TAG << "\",\"openSimLinked\":true,";
        output << "\"model\":{\"id\":\"" << kModelId
               << "\",\"name\":\"" << kModelName
               << "\",\"sourceVersion\":\"4.1\",\"runtimeVersion\":\""
               << OPENSIM_SOURCE_TAG << "\",\"scope\":\"right upper extremity\",";
        output << "\"sha256\":\"" << kModelSha256
               << "\",\"archiveSha256\":\"" << kArchiveSha256 << "\",";
        output << "\"bodies\":" << bodyCount()
               << ",\"coordinates\":" << coordinateCount()
               << ",\"poseCoordinates\":" << kPoseCoordinates.size()
               << ",\"muscles\":" << muscleCount()
               << ",\"ligaments\":" << ligamentCount()
               << ",\"meshes\":" << meshCount() << "},";
        output << "\"gpu\":{\"available\":"
               << (gpuName == "unavailable" ? "false" : "true")
               << ",\"name\":\"" << jsonEscape(gpuName) << "\"},";
        output << "\"benchmark\":{\"id\":\"" << kBenchmarkId
               << "\",\"ready\":true,\"frames\":" << benchmarkFrames_.size()
               << ",\"sha256\":\"" << kBenchmarkSha256 << "\"},";
        output << "\"staticHolding\":{\"ready\":true,"
               << "\"endpoint\":\"/api/static-hold\","
               << "\"poseCoordinates\":" << kPoseCoordinates.size()
               << ",\"lockedBaseCoordinates\":6,"
               << "\"reserveTorqueLimitNm\":";
        appendNumber(output, kStaticReserveTorqueLimitNm);
        output << "},";
        output << "\"clinicalUse\":false,"
               << "\"validation\":\"Package integrity, benchmark structure, and default-pose geometry/path checks passed. Stored benchmark states were authored for OpenSim 4.1 and have not been independently revalidated on this runtime.\"}";
        return output.str();
    }

    std::string modelJson() const {
        std::ostringstream output;
        output << "{\"id\":\"" << kModelId << "\",\"name\":\""
               << kModelName << "\",\"scope\":\"right upper extremity\",";
        output << "\"source\":{\"url\":\"" << kSourceUrl
               << "\",\"modelSha256\":\"" << kModelSha256
               << "\",\"archiveSha256\":\"" << kArchiveSha256 << "\"},";
        output << "\"units\":{\"length\":\"m\",\"angle\":\"deg\","
               << "\"momentArm\":\"m\"},";
        output << "\"counts\":{\"bodies\":" << bodyCount()
               << ",\"coordinates\":" << coordinateCount()
               << ",\"muscles\":" << muscleCount()
               << ",\"ligaments\":" << ligamentCount()
               << ",\"meshes\":" << meshCount() << "},";

        output << "\"coordinates\":[";
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (index > 0) output << ',';
            const auto& spec = kPoseCoordinates[index];
            const auto& coordinate = model_->getCoordinateSet().get(spec.name);
            output << "{\"name\":\"" << spec.name << "\",\"label\":\""
                   << jsonEscape(spec.label) << "\",\"default\":";
            appendNumber(output, SimTK::convertRadiansToDegrees(
                                     coordinate.getDefaultValue()));
            output << ",\"min\":";
            appendNumber(output, SimTK::convertRadiansToDegrees(
                                     coordinate.getRangeMin()));
            output << ",\"max\":";
            appendNumber(output, SimTK::convertRadiansToDegrees(
                                     coordinate.getRangeMax()));
            output << '}';
        }
        output << "],\"muscles\":[";
        const auto& muscles = model_->getMuscles();
        for (int index = 0; index < muscles.getSize(); ++index) {
            if (index > 0) output << ',';
            output << '"' << jsonEscape(muscles.get(index).getName()) << '"';
        }

        output << "],\"meshes\":[";
        bool firstMesh = true;
        for (const auto& mesh : model_->getComponentList<OpenSim::Mesh>()) {
            if (!firstMesh) output << ',';
            firstMesh = false;
            const auto& color = mesh.get_Appearance().get_color();
            output << "{\"name\":\"" << jsonEscape(mesh.getName())
                   << "\",\"file\":\"" << jsonEscape(mesh.getGeometryFilename())
                   << "\",\"url\":\"/models/mobl_arms/Geometry/"
                   << jsonEscape(mesh.getGeometryFilename())
                   << "\",\"frame\":\"" << jsonEscape(mesh.getFrame().getName())
                   << "\",\"scale\":";
            appendVec3(output, mesh.get_scale_factors());
            output << ",\"color\":";
            appendVec3(output, color);
            output << ",\"opacity\":";
            appendNumber(output, mesh.get_Appearance().get_opacity());
            output << '}';
        }
        output << "],\"notice\":\"Generic research model; not patient-specific and not diagnostic.\"}";
        return output.str();
    }

    std::string poseJson(const std::map<std::string, std::string>& query) {
        applyPose(query);
        return stateJson(selectedMuscle(query), "pose", nullptr,
                         std::nullopt, std::nullopt);
    }

    std::string staticHoldingJson(
            const std::map<std::string, std::string>& query) {
        const auto requestedDegrees = requireExactStaticPose(query);
        applyPose(query);
        const StaticHoldingResult result = solveStaticHolding(requestedDegrees);
        const char* interpretation = result.usable
            ? "Generic-model minimum-squared-control active-muscle estimate for this exact static posture under the model's gravity and modeled arm-segment weights, with no external load. Passive muscle-fiber force is not included by this StaticOptimization formulation. Not measured patient data, force, pain, injury, fatigue, or a diagnosis."
            : "Exact pose geometry only. Static-holding activations were withheld because the on-demand optimization did not pass its convergence, constrained generalized-force equilibrium, and reserve-torque quality gates.";
        std::string response = stateJson(
            selectedMuscle(query), "static",
            result.usable ? &result.activations : nullptr,
            std::nullopt, std::nullopt,
            "on-demand OpenSim 4.6 static optimization", interpretation);

        std::ostringstream details;
        details << ",\"staticHolding\":{\"method\":\"OpenSim inverse-dynamics torque balance with bounded SimTK static optimization\",";
        details << "\"requestedCoordinatesDegrees\":{";
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (index > 0) details << ',';
            details << '"' << kPoseCoordinates[index].name << "\":";
            appendNumber(details, requestedDegrees[index]);
        }
        details << "},";
        details << "\"assumptions\":{\"velocity\":\"zero\","
                << "\"acceleration\":\"zero\",\"externalLoad\":\"none\","
                << "\"gravityMPerS2\":[0,-9.80665,0],"
                << "\"segmentWeights\":\"model-defined\","
                << "\"passiveMuscleFiberForce\":\"not included by this StaticOptimization active-actuation formulation\","
                << "\"equilibrium\":\"full inverse-dynamics mobility residual balanced by actuator controls and authored constraint reactions\","
                << "\"base\":\"six free thorax coordinates locked at model defaults\","
                << "\"coupledCoordinates\":\"authored scapula, clavicle, shoulder and wrist constraints preserved\"},";
        details << "\"solver\":{\"algorithm\":\"SimTK InteriorPoint\","
                << "\"activationExponent\":2,\"musclePhysiology\":true,"
                << "\"maximumIterations\":" << kStaticMaximumIterations << ','
                << "\"maximumCpuSeconds\":";
        appendNumber(details, kStaticMaximumCpuSeconds);
        details << ','
                << "\"physicalMatrixBuilds\":"
                << result.physicalLinearizations << ','
                << "\"constraintMultipliers\":"
                << result.constraintMultipliers << ','
                << "\"converged\":"
                << (result.optimizerConverged ? "true" : "false")
                << ",\"durationMs\":";
        appendNumber(details, result.durationMilliseconds);
        details << ",\"objective\":";
        appendNumber(details, result.objective);
        if (!result.solverDetail.empty()) {
            details << ",\"detail\":\""
                    << jsonEscape(result.solverDetail) << '"';
        }
        details << "},\"quality\":{\"usable\":"
                << (result.usable ? "true" : "false")
                << ",\"status\":\"" << jsonEscape(result.status)
                << "\",\"reason\":\"" << jsonEscape(result.reason) << "\",";
        details << "\"activationCount\":"
                << (result.usable ? result.activations.size() : 0)
                << ",\"maxAssemblyErrorDegrees\":";
        appendNumber(details, result.maximumAssemblyErrorDegrees);
        details << ",\"assemblyToleranceDegrees\":";
        appendNumber(details, kStaticAssemblyToleranceDegrees);
        details << ",\"maxForwardAccelerationDiagnosticRadPerS2\":";
        appendNumber(details, result.maximumAccelerationResidual);
        details << ",\"rmsForwardAccelerationDiagnosticRadPerS2\":";
        appendNumber(details, result.rmsAccelerationResidual);
        details << ",\"maxGeneralizedForceEquilibriumResidual\":";
        appendNumber(details, result.maximumOptimizerConstraintResidual);
        details << ",\"rmsGeneralizedForceEquilibriumResidual\":";
        appendNumber(details, result.rmsOptimizerConstraintResidual);
        details << ",\"equilibriumResidualLimit\":";
        appendNumber(details, kStaticEquilibriumResidualLimit);
        details << ",\"equilibriumResidualUnits\":\"N or N m, according to mobility\"";
        details << ",\"forwardAccelerationDiagnosticGatesUsability\":false";
        details << ",\"forwardAccelerationDiagnosticInterpretation\":\"Non-gating numerical diagnostic. This generic model has massless and tightly constrained bodies that make forward acceleration ill-conditioned; usability is determined from independently replayed constrained generalized-force equilibrium.\"";
        details << ",\"maxReserveTorqueNm\":";
        appendNumber(details, result.maximumReserveTorqueNm);
        details << ",\"rmsReserveTorqueNm\":";
        appendNumber(details, result.rmsReserveTorqueNm);
        details << ",\"reserveTorqueLimitNm\":";
        appendNumber(details, kStaticReserveTorqueLimitNm);
        details << ",\"reserveCapacityNm\":";
        appendNumber(details,
                     kStaticReserveOptimalForceNm * kStaticReserveControlLimit);
        details << ",\"reserveParameterization\":\"0.5 Nm times a bounded variable in [-1,1]; quadratic weight 625 preserves the cost of a 0.02 Nm/control reserve\"";
        details << ",\"capacityLimitedReserveThresholdNm\":";
        appendNumber(details, kStaticCapacityLimitedReserveThresholdNm);
        details << ",\"muscleCapacityThreshold\":";
        appendNumber(details, kStaticMuscleCapacityThreshold);
        details << ",\"muscleControlLimits\":[";
        appendNumber(details, staticMuscleControlMinimum_);
        details << ',';
        appendNumber(details, staticMuscleControlMaximum_);
        details << "],\"musclesAtLowerControlLimit\":"
                << result.musclesAtLowerControlLimit
                << ",\"musclesAtUpperControlLimit\":"
                << result.musclesAtUpperControlLimit
                << ",\"musclesAtOrAboveCapacityThreshold\":"
                << result.musclesAtOrAboveCapacityThreshold;
        details << "},\"reserves\":[";
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (index > 0) details << ',';
            details << "{\"coordinate\":\"" << kPoseCoordinates[index].name
                    << "\",\"torqueNm\":";
            appendNumber(details, result.reserveTorquesNm[index]);
            details << ",\"forwardAccelerationDiagnosticRadPerS2\":";
            appendNumber(details, result.accelerationResiduals[index]);
            details << '}';
        }
        details << "],\"notice\":\"Research estimate from a generic model; not validated for clinical diagnosis.\"}";
        response.insert(response.size() - 1, details.str());
        return response;
    }

    std::string benchmarkJson() const {
        std::ostringstream output;
        output << "{\"id\":\"" << kBenchmarkId << "\",\"name\":\""
               << kBenchmarkName << "\",\"type\":\"CMC states\",";
        output << "\"source\":{\"project\":\"MoBL-ARMS Upper Extremity Model\",";
        output << "\"url\":\"" << kSourceUrl
               << "\",\"file\":\"Benchmarking Simulations/4.1 Model with Millard-Schutte Matched Curves/CompareResults/Module_6_results/CMC_results_states.sto\",";
        output << "\"sha256\":\"" << kBenchmarkSha256 << "\"},";
        output << "\"modelVersion\":\"OpenSim 4.1\",\"motion\":\"Reach8\",";
        output << "\"frames\":" << benchmarkFrames_.size()
               << ",\"timeStart\":";
        appendNumber(output, benchmarkFrames_.front().time);
        output << ",\"timeEnd\":";
        appendNumber(output, benchmarkFrames_.back().time);
        output << ",\"units\":{\"time\":\"s\",\"coordinates\":\"rad in source; deg in API\",\"activation\":\"0-1 state\"},";
        output << "\"activationRange\":[";
        appendNumber(output, benchmarkActivationMin_);
        output << ',';
        appendNumber(output, benchmarkActivationMax_);
        output << "],\"muscleCount\":" << muscleCount() << ',';
        output << "\"interpretation\":\"Model-estimated activation from the authors' supplied CMC example. It is not force, pain, fatigue, or patient data.\",";
        output << "\"validation\":\"The stored OpenSim 4.1 states file is structurally validated and displayed with this OpenSim runtime; the authors' benchmark has not been independently re-run here.\"}";
        return output.str();
    }

    std::string benchmarkPosesJson() const {
        std::ostringstream output;
        output << "{\"id\":\"" << kBenchmarkId << "\",\"coordinateNames\":[";
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (index > 0) output << ',';
            output << '\"' << kPoseCoordinates[index].name << '\"';
        }
        output << "],\"poses\":[";
        for (std::size_t frameIndex = 0;
             frameIndex < benchmarkFrames_.size(); ++frameIndex) {
            if (frameIndex > 0) output << ',';
            const auto& frame = benchmarkFrames_[frameIndex];
            output << "{\"frame\":" << frameIndex << ",\"time\":";
            appendNumber(output, frame.time);
            output << ",\"values\":[";
            for (std::size_t coordinateIndex = 0;
                 coordinateIndex < kPoseCoordinates.size(); ++coordinateIndex) {
                if (coordinateIndex > 0) output << ',';
                appendNumber(output, SimTK::convertRadiansToDegrees(
                    frame.coordinateRadians[coordinateIndex]));
            }
            output << "]}";
        }
        output << "],\"interpretation\":\"Every entry is an exact authored Reach8 frame with 50 stored CMC activation states.\"}";
        return output.str();
    }

    std::string benchmarkFrameJson(
            const std::map<std::string, std::string>& query) {
        const double requestedTime = queryNumber(query, "t").value_or(
            benchmarkFrames_.front().time);
        const auto upper = std::lower_bound(
            benchmarkFrames_.begin(), benchmarkFrames_.end(), requestedTime,
            [](const BenchmarkFrame& frame, double value) {
                return frame.time < value;
            });
        std::size_t index = 0;
        if (upper == benchmarkFrames_.end()) {
            index = benchmarkFrames_.size() - 1;
        } else if (upper == benchmarkFrames_.begin()) {
            index = 0;
        } else {
            const std::size_t upperIndex = static_cast<std::size_t>(
                std::distance(benchmarkFrames_.begin(), upper));
            const double beforeDistance = std::abs(
                requestedTime - benchmarkFrames_[upperIndex - 1].time);
            const double afterDistance = std::abs(
                benchmarkFrames_[upperIndex].time - requestedTime);
            index = beforeDistance <= afterDistance ? upperIndex - 1 : upperIndex;
        }
        const auto& frame = benchmarkFrames_[index];
        applyBenchmarkFrame(frame);
        return stateJson(selectedMuscle(query), "benchmark", &frame.activations,
                         frame.time, index);
    }

    std::string benchmarkNearestJson(
            const std::map<std::string, std::string>& query) {
        struct RequestedCoordinate {
            std::size_t index;
            double degrees;
        };

        struct SegmentMatch {
            std::size_t lowerIndex{0};
            std::size_t upperIndex{1};
            double fraction{0.0};
            double time{0.0};
            double poseMeanSquaredDegrees{0.0};
            double maximumErrorDegrees{0.0};
            double continuityPenaltyDegreesSquared{0.0};
            double objective{0.0};
            std::array<double, kPoseCoordinates.size()> actualDegrees{};
        };

        std::vector<RequestedCoordinate> requested;
        requested.reserve(kPoseCoordinates.size());
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            const auto& spec = kPoseCoordinates[index];
            const auto value = queryNumber(query, spec.name);
            if (!value.has_value()) continue;
            const auto& coordinate = model_->getCoordinateSet().get(spec.name);
            const double minimum = coordinate.getRangeMin();
            const double maximum = coordinate.getRangeMax();
            const double radians = std::clamp(
                SimTK::convertDegreesToRadians(*value), minimum, maximum);
            requested.push_back({
                index,
                SimTK::convertRadiansToDegrees(radians)
            });
        }
        if (requested.empty()) {
            throw std::runtime_error(
                "Nearest Reach8 frame requires at least one pose coordinate");
        }

        const double anchorTime = std::clamp(
            queryNumber(query, "t").value_or(benchmarkFrames_.front().time),
            benchmarkFrames_.front().time,
            benchmarkFrames_.back().time);
        // A pose that falls between two stored frames should not jump to one
        // endpoint. Project it onto every adjacent Reach8 segment instead and
        // interpolate the stored activations along the selected segment. The
        // small, capped time term only resolves nearly tied trajectory phases;
        // it cannot make a poor pose match pass the coverage checks below.
        std::vector<SegmentMatch> matches;
        matches.reserve(benchmarkFrames_.size() - 1);
        for (std::size_t lowerIndex = 0;
             lowerIndex + 1 < benchmarkFrames_.size(); ++lowerIndex) {
            const auto& lower = benchmarkFrames_[lowerIndex];
            const auto& upper = benchmarkFrames_[lowerIndex + 1];
            double numerator = 0.0;
            double denominator = 0.0;
            for (const auto& target : requested) {
                const double lowerDegrees = SimTK::convertRadiansToDegrees(
                    lower.coordinateRadians[target.index]);
                const double upperDegrees = SimTK::convertRadiansToDegrees(
                    upper.coordinateRadians[target.index]);
                const double direction = upperDegrees - lowerDegrees;
                numerator += (target.degrees - lowerDegrees) * direction;
                denominator += direction * direction;
            }
            const double fraction = denominator > 1e-12
                ? std::clamp(numerator / denominator, 0.0, 1.0)
                : 0.0;

            SegmentMatch match;
            match.lowerIndex = lowerIndex;
            match.upperIndex = lowerIndex + 1;
            match.fraction = fraction;
            match.time = lower.time + fraction * (upper.time - lower.time);
            double squaredErrorDegrees = 0.0;
            for (const auto& target : requested) {
                const double actualRadians =
                    lower.coordinateRadians[target.index] + fraction *
                    (upper.coordinateRadians[target.index] -
                     lower.coordinateRadians[target.index]);
                const double actualDegrees = SimTK::convertRadiansToDegrees(
                    actualRadians);
                match.actualDegrees[target.index] = actualDegrees;
                const double errorDegrees = actualDegrees - target.degrees;
                squaredErrorDegrees += errorDegrees * errorDegrees;
                match.maximumErrorDegrees = std::max(
                    match.maximumErrorDegrees, std::abs(errorDegrees));
            }
            match.poseMeanSquaredDegrees = squaredErrorDegrees /
                static_cast<double>(requested.size());
            const double normalizedTimeDifference =
                (match.time - anchorTime) / 0.25;
            match.continuityPenaltyDegreesSquared = 4.0 * std::min(
                normalizedTimeDifference * normalizedTimeDifference, 1.0);
            match.objective = match.poseMeanSquaredDegrees +
                match.continuityPenaltyDegreesSquared;
            matches.push_back(match);
        }

        const auto chosenIterator = std::min_element(
            matches.begin(), matches.end(),
            [](const SegmentMatch& left, const SegmentMatch& right) {
                return left.objective < right.objective;
            });
        const SegmentMatch& chosen = *chosenIterator;

        const auto interpolateActivations = [&](const SegmentMatch& match) {
            const auto& lower = benchmarkFrames_[match.lowerIndex].activations;
            const auto& upper = benchmarkFrames_[match.upperIndex].activations;
            std::vector<double> values(lower.size(), 0.0);
            for (std::size_t index = 0; index < values.size(); ++index) {
                values[index] = lower[index] + match.fraction *
                    (upper[index] - lower[index]);
            }
            return values;
        };
        std::vector<double> interpolatedActivations =
            interpolateActivations(chosen);

        const SegmentMatch* alternative = nullptr;
        for (const auto& candidate : matches) {
            if (std::abs(candidate.time - chosen.time) < 0.20) continue;
            if (alternative == nullptr || candidate.poseMeanSquaredDegrees <
                    alternative->poseMeanSquaredDegrees) {
                alternative = &candidate;
            }
        }

        double alternativeActivationRmsDifference = 0.0;
        double alternativeActivationMaximumDifference = 0.0;
        double alternativePoseRmsGapDegrees = 0.0;
        bool ambiguous = false;
        if (alternative != nullptr) {
            const auto alternativeActivations =
                interpolateActivations(*alternative);
            double squaredActivationDifference = 0.0;
            for (std::size_t index = 0;
                 index < interpolatedActivations.size(); ++index) {
                const double difference = std::abs(
                    interpolatedActivations[index] -
                    alternativeActivations[index]);
                squaredActivationDifference += difference * difference;
                alternativeActivationMaximumDifference = std::max(
                    alternativeActivationMaximumDifference, difference);
            }
            alternativeActivationRmsDifference = std::sqrt(
                squaredActivationDifference /
                static_cast<double>(interpolatedActivations.size()));
            alternativePoseRmsGapDegrees = std::sqrt(
                alternative->poseMeanSquaredDegrees) -
                std::sqrt(chosen.poseMeanSquaredDegrees);
            ambiguous = alternativePoseRmsGapDegrees <= 1.0 &&
                (alternativeActivationRmsDifference > 0.03 ||
                 alternativeActivationMaximumDifference > 0.10);
        }

        const double rmsErrorDegrees = std::sqrt(
            chosen.poseMeanSquaredDegrees);
        const bool completePose = requested.size() == kPoseCoordinates.size();
        const bool highCoverage = completePose && rmsErrorDegrees <= 2.0 &&
            chosen.maximumErrorDegrees <= 5.0;
        const bool approximateCoverage = completePose &&
            rmsErrorDegrees <= 5.0 && chosen.maximumErrorDegrees <= 10.0;

        std::string coverageStatus;
        std::string coverageReason;
        bool usable = false;
        if (!completePose) {
            coverageStatus = "incomplete";
            coverageReason = "all seven pose angles are required";
        } else if (!approximateCoverage) {
            coverageStatus = "outside";
            coverageReason = "pose is outside the supported Reach8 neighborhood";
        } else if (ambiguous) {
            coverageStatus = "ambiguous";
            coverageReason = "similar Reach8 phases have materially different activations";
        } else if (highCoverage) {
            coverageStatus = "high";
            coverageReason = "pose is close to the authored Reach8 trajectory";
            usable = true;
        } else {
            coverageStatus = "approximate";
            coverageReason = "pose is near, but not on, the authored Reach8 trajectory";
            usable = true;
        }

        // Return the exact requested geometry. Activation values are attached
        // only when the engineering coverage gate accepts the projection.
        applyPose(query);
        const std::size_t representativeIndex = chosen.fraction < 0.5
            ? chosen.lowerIndex : chosen.upperIndex;
        std::string result = stateJson(
            selectedMuscle(query), usable ? "matched" : "pose",
            usable ? &interpolatedActivations : nullptr,
            chosen.time, representativeIndex,
            usable
                ? "linearly interpolated stored OpenSim 4.1 CMC states"
                : "activation unavailable for this requested pose");

        std::ostringstream match;
        match << ",\"match\":{\"method\":\"continuous Reach8 trajectory projection\",";
        match << "\"requested\":{";
        for (std::size_t index = 0; index < requested.size(); ++index) {
            if (index > 0) match << ',';
            const auto& target = requested[index];
            match << '\"' << kPoseCoordinates[target.index].name << "\":";
            appendNumber(match, target.degrees);
        }
        match << "},\"actual\":{";
        for (std::size_t index = 0; index < requested.size(); ++index) {
            if (index > 0) match << ',';
            const auto& target = requested[index];
            match << '\"' << kPoseCoordinates[target.index].name << "\":";
            appendNumber(match, chosen.actualDegrees[target.index]);
        }
        match << "},\"errorsDegrees\":{";
        for (std::size_t index = 0; index < requested.size(); ++index) {
            if (index > 0) match << ',';
            const auto& target = requested[index];
            match << '\"' << kPoseCoordinates[target.index].name << "\":";
            appendNumber(
                match, chosen.actualDegrees[target.index] - target.degrees);
        }
        match << "},\"coordinateCount\":" << requested.size();
        match << ",\"rmsErrorDegrees\":";
        appendNumber(match, rmsErrorDegrees);
        match << ",\"maxErrorDegrees\":";
        appendNumber(match, chosen.maximumErrorDegrees);
        match << ",\"time\":";
        appendNumber(match, chosen.time);
        match << ",\"coverage\":{\"status\":\"" << coverageStatus
              << "\",\"usable\":" << (usable ? "true" : "false")
              << ",\"reason\":\"" << jsonEscape(coverageReason) << "\"}";
        match << ",\"interpolation\":{\"lowerFrame\":"
              << chosen.lowerIndex << ",\"upperFrame\":"
              << chosen.upperIndex << ",\"fraction\":";
        appendNumber(match, chosen.fraction);
        match << '}';
        match << ",\"continuity\":{\"anchorTime\":";
        appendNumber(match, anchorTime);
        match << ",\"deltaTime\":";
        appendNumber(match, chosen.time - anchorTime);
        match << ",\"penaltyDegreesSquared\":";
        appendNumber(match, chosen.continuityPenaltyDegreesSquared);
        match << '}';
        match << ",\"ambiguity\":{\"ambiguous\":"
              << (ambiguous ? "true" : "false");
        if (alternative != nullptr) {
            match << ",\"alternativeTime\":";
            appendNumber(match, alternative->time);
            match << ",\"poseRmsGapDegrees\":";
            appendNumber(match, alternativePoseRmsGapDegrees);
            match << ",\"activationRmsDifference\":";
            appendNumber(match, alternativeActivationRmsDifference);
            match << ",\"activationMaxDifference\":";
            appendNumber(match, alternativeActivationMaximumDifference);
        }
        match << '}';
        match << ",\"activationInterpolation\":\"linear between adjacent stored CMC states\"";
        match << '}';

        result.insert(result.size() - 1, match.str());
        return result;
    }

    std::string selfTestJson() {
        validatePackage();
        applyPose({});
        int checkedPaths = 0;
        const auto& muscles = model_->getMuscles();
        for (int index = 0; index < muscles.getSize(); ++index) {
            const auto& muscle = muscles.get(index);
            const auto& path = muscle.getGeometryPath().getCurrentPath(state_);
            if (path.getSize() < 2 || !std::isfinite(muscle.getLength(state_))) {
                throw std::runtime_error(
                    "Invalid default geometry path for muscle " + muscle.getName());
            }
            for (int pointIndex = 0; pointIndex < path.getSize(); ++pointIndex) {
                const auto& location = path.get(pointIndex)->getLocationInGround(state_);
                if (!location.isFinite()) {
                    throw std::runtime_error(
                        "Non-finite path point for muscle " + muscle.getName());
                }
            }
            ++checkedPaths;
        }
        std::ostringstream output;
        output << "{\"status\":\"ok\",\"engine\":\"OpenSim C++ "
               << OPENSIM_SOURCE_TAG << "\",\"model\":\"" << kModelId
               << "\",\"modelSha256\":\"" << kModelSha256
               << "\",\"bodies\":" << bodyCount()
               << ",\"coordinates\":" << coordinateCount()
               << ",\"muscles\":" << muscleCount()
               << ",\"ligaments\":" << ligamentCount()
               << ",\"meshes\":" << meshCount()
               << ",\"checkedMusclePaths\":" << checkedPaths
               << ",\"benchmark\":{\"id\":\"" << kBenchmarkId
               << "\",\"sha256\":\"" << kBenchmarkSha256
               << "\",\"frames\":" << benchmarkFrames_.size()
               << ",\"timeStart\":";
        appendNumber(output, benchmarkFrames_.front().time);
        output << ",\"timeEnd\":";
        appendNumber(output, benchmarkFrames_.back().time);
        output << ",\"muscleActivationsPerFrame\":" << muscleCount()
               << "}}";
        return output.str();
    }

private:
    std::optional<std::size_t> poseCoordinateIndex(
            const std::string& name) const {
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (name == kPoseCoordinates[index].name) return index;
        }
        return std::nullopt;
    }

    std::array<double, kPoseCoordinates.size()> requireExactStaticPose(
            const std::map<std::string, std::string>& query) const {
        std::array<double, kPoseCoordinates.size()> requestedDegrees{};
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            const auto& spec = kPoseCoordinates[index];
            const auto value = queryNumber(query, spec.name);
            if (!value.has_value()) {
                throw std::invalid_argument(
                    "Static holding requires all seven angles; missing " +
                    std::string(spec.name));
            }
            const auto& coordinate = model_->getCoordinateSet().get(spec.name);
            const double minimumDegrees = SimTK::convertRadiansToDegrees(
                coordinate.getRangeMin());
            const double maximumDegrees = SimTK::convertRadiansToDegrees(
                coordinate.getRangeMax());
            if (*value < minimumDegrees - kStaticInputRangeToleranceDegrees ||
                    *value > maximumDegrees +
                        kStaticInputRangeToleranceDegrees) {
                std::ostringstream message;
                message << spec.name << " must be between "
                        << minimumDegrees << " and " << maximumDegrees
                        << " degrees";
                throw std::invalid_argument(message.str());
            }
            // Permit round-tripping the API's eight-decimal model limits while
            // retaining the exact authored bound internally.
            requestedDegrees[index] = std::clamp(
                *value, minimumDegrees, maximumDegrees);
        }
        return requestedDegrees;
    }

    std::string staticReserveName(const std::string& coordinateName) const {
        return "static_reserve_" + coordinateName;
    }

    void initializeStaticHoldingModel() {
        staticModel_.reset(model_->clone());

        // The authored model has six independent thorax free-joint coordinates
        // in addition to the seven requested arm coordinates. Lock only those
        // independent non-pose coordinates. Dependent scapula, clavicle,
        // shoulder and wrist coordinates remain governed by their authored
        // CoordinateCouplerConstraints.
        int lockedBaseCoordinates = 0;
        auto& staticCoordinates = staticModel_->updCoordinateSet();
        for (int index = 0; index < staticCoordinates.getSize(); ++index) {
            auto& coordinate = staticCoordinates.get(index);
            const auto& sourceCoordinate = model_->getCoordinateSet().get(
                coordinate.getName());
            if (!poseCoordinateIndex(coordinate.getName()).has_value() &&
                    !sourceCoordinate.isDependent(defaultState_)) {
                coordinate.setDefaultValue(
                    sourceCoordinate.getValue(defaultState_));
                coordinate.setDefaultLocked(true);
                ++lockedBaseCoordinates;
            }
        }
        if (lockedBaseCoordinates != 6) {
            throw std::runtime_error(
                "Static model expected exactly six independent base coordinates");
        }

        for (const auto& spec : kPoseCoordinates) {
            auto* reserve = new OpenSim::CoordinateActuator();
            reserve->setName(staticReserveName(spec.name));
            reserve->setCoordinate(
                &staticModel_->updCoordinateSet().get(spec.name));
            reserve->setOptimalForce(kStaticReserveOptimalForceNm);
            reserve->setMinControl(-kStaticReserveControlLimit);
            reserve->setMaxControl(kStaticReserveControlLimit);
            staticModel_->addForce(reserve);
        }

        staticModel_->finalizeConnections();
        staticDefaultState_ = staticModel_->initSystem();
        staticModel_->setAllControllersEnabled(false);
        staticMuscleControlMinimum_ = std::numeric_limits<double>::infinity();
        staticMuscleControlMaximum_ = -std::numeric_limits<double>::infinity();
        const auto& staticMuscles = staticModel_->getMuscles();
        for (int index = 0; index < staticMuscles.getSize(); ++index) {
            staticMuscleControlMinimum_ = std::min(
                staticMuscleControlMinimum_,
                staticMuscles.get(index).getMinControl());
            staticMuscleControlMaximum_ = std::max(
                staticMuscleControlMaximum_,
                staticMuscles.get(index).getMaxControl());
        }
        const auto& actuators = staticModel_->getActuators();
        for (int index = 0; index < actuators.getSize(); ++index) {
            const auto* scalar = dynamic_cast<const OpenSim::ScalarActuator*>(
                &actuators.get(index));
            if (scalar == nullptr) {
                throw std::runtime_error(
                    "Static holding supports scalar actuators only");
            }
            scalar->overrideActuation(staticDefaultState_, true);
        }

        staticAccelerationCoordinateNames_.clear();
        const auto coordinates =
            staticModel_->getCoordinatesInMultibodyTreeOrder();
        for (std::size_t index = 0; index < coordinates.size(); ++index) {
            const auto& coordinate = coordinates[index];
            if (!coordinate->isConstrained(staticDefaultState_)) {
                staticAccelerationCoordinateNames_.push_back(
                    coordinate->getName());
            }
        }
        if (staticAccelerationCoordinateNames_.size() !=
                kPoseCoordinates.size()) {
            throw std::runtime_error(
                "Static model must have exactly seven unconstrained arm coordinates");
        }
        for (const auto& name : staticAccelerationCoordinateNames_) {
            if (!poseCoordinateIndex(name).has_value()) {
                throw std::runtime_error(
                    "Unexpected unconstrained coordinate in static model: " + name);
            }
        }
    }

    StaticHoldingResult solveStaticHolding(
            const std::array<double, kPoseCoordinates.size()>&
                requestedDegrees) {
        StaticHoldingResult result;
        const double nan = std::numeric_limits<double>::quiet_NaN();
        result.reserveTorquesNm.fill(nan);
        result.accelerationResiduals.fill(nan);
        const auto started = std::chrono::steady_clock::now();

        try {
            SimTK::State solverState = staticDefaultState_;
            solverState.setTime(0.0);
            for (std::size_t index = 0;
                 index < kPoseCoordinates.size(); ++index) {
                auto& coordinate = staticModel_->updCoordinateSet().get(
                    kPoseCoordinates[index].name);
                coordinate.setValue(
                    solverState,
                    SimTK::convertDegreesToRadians(requestedDegrees[index]),
                    false);
            }
            staticModel_->assemble(solverState);
            solverState.updU() = 0;
            staticModel_->getMultibodySystem().realize(
                solverState, SimTK::Stage::Velocity);

            result.maximumAssemblyErrorDegrees = 0.0;
            for (std::size_t index = 0;
                 index < kPoseCoordinates.size(); ++index) {
                const auto& coordinate = staticModel_->getCoordinateSet().get(
                    kPoseCoordinates[index].name);
                const double actualDegrees = SimTK::convertRadiansToDegrees(
                    coordinate.getValue(solverState));
                const double assemblyErrorDegrees = std::abs(
                    actualDegrees - requestedDegrees[index]);
                result.maximumAssemblyErrorDegrees = std::max(
                    result.maximumAssemblyErrorDegrees, assemblyErrorDegrees);
                if (assemblyErrorDegrees >
                        kStaticAssemblyToleranceDegrees) {
                    std::ostringstream message;
                    message << "Model assembly changed requested coordinate "
                            << kPoseCoordinates[index].name << " from "
                            << requestedDegrees[index] << " to "
                            << actualDegrees << " degrees (delta "
                            << (actualDegrees - requestedDegrees[index]) << ')';
                    throw std::runtime_error(message.str());
                }
            }

            staticModel_->equilibrateMuscles(solverState);

            const int actuatorCount = staticModel_->getActuators().getSize();
            const int accelerationCount = static_cast<int>(
                staticAccelerationCoordinateNames_.size());
            SimTK::Vector parameters(actuatorCount, 0.0);
            SimTK::Vector lowerBounds(actuatorCount);
            SimTK::Vector upperBounds(actuatorCount);
            SimTK::Vector optimalForces(actuatorCount);
            std::map<std::string, double> lowerControlByName;
            std::map<std::string, double> upperControlByName;
            std::vector<OpenSim::ScalarActuator*> scalarActuators;
            scalarActuators.reserve(static_cast<std::size_t>(actuatorCount));
            int scalarIndex = 0;
            auto& forceSet = staticModel_->updForceSet();
            for (int index = 0; index < forceSet.getSize(); ++index) {
                auto* actuator =
                    dynamic_cast<OpenSim::ScalarActuator*>(
                        &forceSet.get(index));
                if (actuator == nullptr) continue;
                if (scalarIndex >= actuatorCount) {
                    throw std::runtime_error(
                        "Static actuator inventory exceeds optimizer parameters");
                }
                lowerBounds[scalarIndex] = actuator->getMinControl();
                upperBounds[scalarIndex] = actuator->getMaxControl();
                lowerControlByName[actuator->getName()] =
                    actuator->getMinControl();
                upperControlByName[actuator->getName()] =
                    actuator->getMaxControl();
                scalarActuators.push_back(actuator);
                if (auto* muscle = dynamic_cast<OpenSim::Muscle*>(actuator)) {
                    staticModel_->setAllControllersEnabled(true);
                    optimalForces[scalarIndex] =
                        muscle->calcInextensibleTendonActiveFiberForce(
                            solverState, 1.0);
                    staticModel_->setAllControllersEnabled(false);
                } else {
                    optimalForces[scalarIndex] = actuator->getOptimalForce();
                }
                if (!std::isfinite(optimalForces[scalarIndex])) {
                    throw std::runtime_error(
                        "Static actuator produced a non-finite optimal force: " +
                        actuator->getName());
                }
                parameters[scalarIndex] = std::clamp(
                    0.0, lowerBounds[scalarIndex], upperBounds[scalarIndex]);
                ++scalarIndex;
            }
            if (scalarIndex != actuatorCount) {
                throw std::runtime_error(
                    "Static actuator inventory does not match optimizer parameters");
            }
            const auto makeControlledState = [&](
                    const SimTK::Vector& controls) {
                SimTK::State evaluationState = staticDefaultState_;
                staticModel_->initStateWithoutRecreatingSystem(evaluationState);
                evaluationState.setTime(0.0);
                evaluationState.updQ() = solverState.getQ();
                evaluationState.updU() = 0;
                for (int index = 0; index < actuatorCount; ++index) {
                    auto* actuator = scalarActuators[
                        static_cast<std::size_t>(index)];
                    actuator->overrideActuation(evaluationState, true);
                    actuator->setOverrideActuation(
                        evaluationState,
                        controls[index] * optimalForces[index]);
                }
                return evaluationState;
            };

            const auto realizeAccelerations = [&](const SimTK::Vector& controls,
                                                  SimTK::State* realizedState) {
                SimTK::State evaluationState = makeControlledState(controls);
                staticModel_->getMultibodySystem().realize(
                    evaluationState, SimTK::Stage::Acceleration);
                SimTK::Vector accelerations(accelerationCount);
                for (int index = 0; index < accelerationCount; ++index) {
                    // Coordinate tree position is not a reliable global UDot
                    // index for this CustomJoint-heavy model. Ask each
                    // Coordinate for its authoritative mapped acceleration.
                    accelerations[index] = staticModel_->getCoordinateSet()
                        .get(staticAccelerationCoordinateNames_.at(
                            static_cast<std::size_t>(index)))
                        .getAccelerationValue(evaluationState);
                }
                if (realizedState != nullptr) {
                    *realizedState = evaluationState;
                }
                return accelerations;
            };

            const int mobilityCount = staticModel_->getNumSpeeds();
            const SimTK::Vector zeroGeneralizedAccelerations(
                mobilityCount, 0.0);
            SimTK::Vector constraints(mobilityCount);
            SimTK::Vector realizedAccelerations(accelerationCount);
            SimTK::State constraintState = makeControlledState(parameters);
            staticModel_->getMultibodySystem().realize(
                constraintState, SimTK::Stage::Velocity);
            SimTK::Matrix constraintTranspose;
            staticModel_->getMatterSubsystem().calcGTranspose(
                constraintState, constraintTranspose);
            if (constraintTranspose.nrow() != mobilityCount) {
                throw std::runtime_error(
                    "Constraint transpose row count does not match mobilities");
            }
            const int multiplierCount = constraintTranspose.ncol();
            result.constraintMultipliers = multiplierCount;
            const SimTK::Vector zeroConstraintMultipliers(
                multiplierCount, 0.0);
            const auto residualMobilityForces = [
                    &, zeroGeneralizedAccelerations](
                    const SimTK::Vector& controls,
                    const SimTK::Vector& constraintMultipliers) {
                SimTK::State evaluationState = makeControlledState(controls);
                const auto& system = staticModel_->getMultibodySystem();
                system.realize(evaluationState, SimTK::Stage::Dynamics);
                const auto& appliedMobilityForces = system.getMobilityForces(
                    evaluationState, SimTK::Stage::Dynamics);
                const auto& appliedBodyForces = system.getRigidBodyForces(
                    evaluationState, SimTK::Stage::Dynamics);
                SimTK::Vector residual;
                staticModel_->getMatterSubsystem().calcResidualForce(
                    evaluationState,
                    appliedMobilityForces,
                    appliedBodyForces,
                    zeroGeneralizedAccelerations,
                    constraintMultipliers,
                    residual);
                return residual;
            };

            ++result.physicalLinearizations;
            const SimTK::Vector baselineResidual = residualMobilityForces(
                parameters, zeroConstraintMultipliers);

            SimTK::Matrix controlResidualMatrix(
                mobilityCount, actuatorCount);
            SimTK::Vector perturbedControls = parameters;
            constexpr double controlStep = 1.0e-2;
            for (int actuatorIndex = 0;
                 actuatorIndex < actuatorCount; ++actuatorIndex) {
                perturbedControls[actuatorIndex] += controlStep;
                const SimTK::Vector perturbedResidual =
                    residualMobilityForces(
                        perturbedControls, zeroConstraintMultipliers);
                perturbedControls[actuatorIndex] -= controlStep;
                for (int mobility = 0; mobility < mobilityCount; ++mobility) {
                    controlResidualMatrix(mobility, actuatorIndex) =
                        (perturbedResidual[mobility] -
                         baselineResidual[mobility]) / controlStep;
                }
            }

            const int optimizationParameterCount =
                actuatorCount + multiplierCount;
            SimTK::Matrix equilibriumMatrix(
                mobilityCount, optimizationParameterCount, 0.0);
            for (int row = 0; row < mobilityCount; ++row) {
                for (int column = 0; column < actuatorCount; ++column) {
                    equilibriumMatrix(row, column) =
                        controlResidualMatrix(row, column);
                }
                for (int column = 0; column < multiplierCount; ++column) {
                    equilibriumMatrix(row, actuatorCount + column) =
                        constraintTranspose(row, column);
                }
            }
            const SimTK::Vector equilibriumOffset =
                baselineResidual - controlResidualMatrix * parameters;
            SimTK::Vector objectiveWeights(
                optimizationParameterCount, 1.0e-12);
            SimTK::Vector optimizationParameters(
                optimizationParameterCount, 0.0);
            SimTK::Vector optimizationLowerBounds(
                optimizationParameterCount, -1.0e6);
            SimTK::Vector optimizationUpperBounds(
                optimizationParameterCount, 1.0e6);
            for (int index = 0; index < actuatorCount; ++index) {
                objectiveWeights[index] =
                    scalarActuators[static_cast<std::size_t>(index)]
                            ->getName().rfind("static_reserve_", 0) == 0
                    ? kStaticReserveObjectiveWeight : 1.0;
                optimizationParameters[index] = parameters[index];
                optimizationLowerBounds[index] = lowerBounds[index];
                optimizationUpperBounds[index] = upperBounds[index];
            }

            BoundedStaticEquilibriumTarget target(
                equilibriumMatrix, equilibriumOffset, objectiveWeights);
            target.setParameterLimits(
                optimizationLowerBounds, optimizationUpperBounds);

            SimTK::Optimizer optimizer(target, SimTK::InteriorPoint);
            optimizer.setDiagnosticsLevel(0);
            optimizer.setConvergenceTolerance(1.0e-5);
            optimizer.setConstraintTolerance(1.0e-6);
            optimizer.setMaxIterations(kStaticMaximumIterations);
            optimizer.useNumericalGradient(false);
            optimizer.useNumericalJacobian(false);
            optimizer.setLimitedMemoryHistory(200);
            optimizer.setAdvancedBoolOption("warm_start", false);
            // The HTTP service is intentionally single-threaded. Bound IPOPT
            // CPU time so one difficult posture cannot monopolize it.
            optimizer.setAdvancedRealOption(
                "max_cpu_time", kStaticMaximumCpuSeconds);

            result.objective = optimizer.optimize(optimizationParameters);
            result.optimizerConverged = true;
            for (int index = 0; index < actuatorCount; ++index) {
                parameters[index] = optimizationParameters[index];
            }
            SimTK::Vector multipliers(multiplierCount);
            for (int index = 0; index < multiplierCount; ++index) {
                multipliers[index] =
                    optimizationParameters[actuatorCount + index];
            }
            // Replay the final physical controls and constraint reactions on
            // a fresh state. This is independent of the optimizer's affine
            // equality evaluation and is the authoritative usability gate.
            constraints = residualMobilityForces(parameters, multipliers);
            realizedAccelerations = realizeAccelerations(parameters, nullptr);
            SimTK::Vector actuations(actuatorCount);
            for (int index = 0; index < actuatorCount; ++index) {
                actuations[index] = parameters[index] * optimalForces[index];
            }

            std::map<std::string, double> controlsByName;
            std::map<std::string, double> actuationsByName;
            scalarIndex = 0;
            for (int index = 0; index < forceSet.getSize(); ++index) {
                const auto* actuator =
                    dynamic_cast<const OpenSim::ScalarActuator*>(
                        &forceSet.get(index));
                if (actuator == nullptr) continue;
                controlsByName[actuator->getName()] = parameters[scalarIndex];
                actuationsByName[actuator->getName()] = actuations[scalarIndex];
                ++scalarIndex;
            }

            bool validActivations = true;
            result.activations.reserve(static_cast<std::size_t>(muscleCount()));
            const auto& muscles = model_->getMuscles();
            for (int index = 0; index < muscles.getSize(); ++index) {
                const auto found = controlsByName.find(
                    muscles.get(index).getName());
                const auto lowerFound = lowerControlByName.find(
                    muscles.get(index).getName());
                const auto upperFound = upperControlByName.find(
                    muscles.get(index).getName());
                if (found == controlsByName.end() ||
                        lowerFound == lowerControlByName.end() ||
                        upperFound == upperControlByName.end() ||
                        !std::isfinite(found->second) ||
                        found->second < lowerFound->second - 1.0e-6 ||
                        found->second > upperFound->second + 1.0e-6) {
                    validActivations = false;
                    result.activations.push_back(nan);
                } else {
                    const double activation = std::clamp(
                        found->second, lowerFound->second, upperFound->second);
                    result.activations.push_back(activation);
                    if (activation <= lowerFound->second + 1.0e-5) {
                        ++result.musclesAtLowerControlLimit;
                    }
                    if (activation >= upperFound->second - 1.0e-5) {
                        ++result.musclesAtUpperControlLimit;
                    }
                    if (activation >= kStaticMuscleCapacityThreshold) {
                        ++result.musclesAtOrAboveCapacityThreshold;
                    }
                }
            }

            double squaredReserveTorque = 0.0;
            result.maximumReserveTorqueNm = 0.0;
            for (std::size_t index = 0;
                 index < kPoseCoordinates.size(); ++index) {
                const auto found = actuationsByName.find(
                    staticReserveName(kPoseCoordinates[index].name));
                const double torque = found == actuationsByName.end()
                    ? nan : found->second;
                result.reserveTorquesNm[index] = torque;
                if (!std::isfinite(torque)) {
                    validActivations = false;
                    continue;
                }
                result.maximumReserveTorqueNm = std::max(
                    result.maximumReserveTorqueNm, std::abs(torque));
                squaredReserveTorque += torque * torque;
            }
            result.rmsReserveTorqueNm = std::sqrt(
                squaredReserveTorque /
                static_cast<double>(kPoseCoordinates.size()));

            double squaredOptimizerConstraintResidual = 0.0;
            result.maximumOptimizerConstraintResidual = 0.0;
            for (int index = 0; index < mobilityCount; ++index) {
                const double residual = constraints[index];
                if (!std::isfinite(residual)) {
                    validActivations = false;
                    continue;
                }
                result.maximumOptimizerConstraintResidual = std::max(
                    result.maximumOptimizerConstraintResidual,
                    std::abs(residual));
                squaredOptimizerConstraintResidual += residual * residual;
            }
            result.rmsOptimizerConstraintResidual = std::sqrt(
                squaredOptimizerConstraintResidual /
                static_cast<double>(mobilityCount));

            double squaredAccelerationResidual = 0.0;
            result.maximumAccelerationResidual = 0.0;
            for (int index = 0; index < accelerationCount; ++index) {
                const double residual = realizedAccelerations[index];
                const auto poseIndex = poseCoordinateIndex(
                    staticAccelerationCoordinateNames_[
                        static_cast<std::size_t>(index)]);
                if (!poseIndex.has_value() || !std::isfinite(residual)) {
                    validActivations = false;
                    continue;
                }
                result.accelerationResiduals[*poseIndex] = residual;
                result.maximumAccelerationResidual = std::max(
                    result.maximumAccelerationResidual, std::abs(residual));
                squaredAccelerationResidual += residual * residual;
            }
            result.rmsAccelerationResidual = std::sqrt(
                squaredAccelerationResidual /
                static_cast<double>(accelerationCount));

            if (!validActivations || !std::isfinite(result.objective)) {
                result.status = "invalid_result";
                result.reason =
                    "The optimizer returned non-finite or out-of-range values";
            } else if (result.maximumOptimizerConstraintResidual >
                    kStaticEquilibriumResidualLimit) {
                result.status = "equilibrium_residual_too_high";
                result.reason =
                    "The independently recomputed generalized-force equilibrium residual exceeds the quality limit";
            } else if (result.maximumReserveTorqueNm >
                    kStaticReserveTorqueLimitNm) {
                result.status = "reserve_too_high";
                result.reason =
                    "The posture requires more reserve torque than the quality limit permits";
            } else if (result.musclesAtOrAboveCapacityThreshold > 0 &&
                    result.maximumReserveTorqueNm >=
                        kStaticCapacityLimitedReserveThresholdNm) {
                result.status = "capacity_limited";
                result.reason =
                    "At least one muscle reached the conservative capacity threshold while nontrivial reserve torque was still required";
            } else {
                result.usable = true;
                result.status = "usable";
                result.reason =
                    "Converged with independently replayed constrained generalized-force equilibrium and small reserve torques";
            }
        } catch (const SimTK::Exception::Base& error) {
            result.status = "solver_failed";
            result.reason = "The static optimization solver did not converge";
            result.solverDetail = error.getMessage();
        } catch (const std::exception& error) {
            result.status = "solver_failed";
            result.reason = "The static optimization calculation failed";
            result.solverDetail = error.what();
        }

        result.durationMilliseconds =
            std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - started).count();
        if (!result.usable) result.activations.clear();
        return result;
    }

    std::string selectedMuscle(
            const std::map<std::string, std::string>& query) const {
        std::string name = "BIClong";
        if (const auto selected = query.find("muscle"); selected != query.end()) {
            name = selected->second;
        }
        if (!model_->getMuscles().contains(name)) {
            throw std::runtime_error("Unknown muscle: " + name);
        }
        return name;
    }

    std::string stateJson(
            const std::string& selected,
            const char* mode,
            const std::vector<double>* activations,
            std::optional<double> benchmarkTime,
            std::optional<std::size_t> benchmarkIndex,
            const char* activationSource =
                "stored OpenSim 4.1 CMC state",
            const char* interpretation = nullptr) {
        std::ostringstream output;
        output << "{\"model\":\"" << kModelId << "\",\"mode\":\""
               << mode << "\",\"selectedMuscle\":\""
               << jsonEscape(selected) << "\"";
        if (benchmarkTime.has_value()) {
            output << ",\"benchmark\":{\"id\":\"" << kBenchmarkId
                   << "\",\"time\":";
            appendNumber(output, *benchmarkTime);
            output << ",\"frame\":" << *benchmarkIndex
                   << ",\"activationSource\":\""
                   << jsonEscape(activationSource) << "\"}";
        }
        output << ",\"coordinates\":{";
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            if (index > 0) output << ',';
            const auto& spec = kPoseCoordinates[index];
            const auto& coordinate = model_->getCoordinateSet().get(spec.name);
            output << '"' << spec.name << "\":";
            appendNumber(output, SimTK::convertRadiansToDegrees(
                                     coordinate.getValue(state_)));
        }
        output << "},\"bodies\":[";
        const auto& bodies = model_->getBodySet();
        for (int index = 0; index < bodies.getSize(); ++index) {
            if (index > 0) output << ',';
            const auto& body = bodies.get(index);
            const auto& transform = body.getTransformInGround(state_);
            output << "{\"name\":\"" << jsonEscape(body.getName())
                   << "\",\"position\":";
            appendVec3(output, transform.p());
            output << ",\"rotation\":";
            appendRotation(output, transform.R());
            output << '}';
        }

        output << "],\"muscles\":[";
        const auto& muscles = model_->getMuscles();
        for (int index = 0; index < muscles.getSize(); ++index) {
            if (index > 0) output << ',';
            const auto& muscle = muscles.get(index);
            const auto& path = muscle.getGeometryPath().getCurrentPath(state_);
            output << "{\"name\":\"" << jsonEscape(muscle.getName())
                   << "\",\"lengthM\":";
            appendNumber(output, muscle.getLength(state_));
            if (activations != nullptr) {
                output << ",\"activation\":";
                appendNumber(output, activations->at(static_cast<std::size_t>(index)));
            }
            output << ",\"points\":[";
            for (int pointIndex = 0; pointIndex < path.getSize(); ++pointIndex) {
                if (pointIndex > 0) output << ',';
                appendVec3(output, path.get(pointIndex)->getLocationInGround(state_));
            }
            output << ']';
            if (muscle.getName() == selected) {
                output << ",\"momentArms\":{";
                for (std::size_t coordinateIndex = 0;
                     coordinateIndex < kPoseCoordinates.size(); ++coordinateIndex) {
                    if (coordinateIndex > 0) output << ',';
                    const auto& spec = kPoseCoordinates[coordinateIndex];
                    auto& coordinate = model_->updCoordinateSet().get(spec.name);
                    output << '"' << spec.name << "\":";
                    appendNumber(output,
                        muscle.computeMomentArm(state_, coordinate));
                }
                output << '}';
            }
            output << '}';
        }
        if (interpretation != nullptr) {
            output << "],\"interpretation\":\""
                   << jsonEscape(interpretation) << "\"}";
        } else if (activations == nullptr) {
            output << "],\"interpretation\":\"Pose geometry only. No activation, force, injury, or pain inference is calculated.\"}";
        } else {
            output << "],\"interpretation\":\"Stored model-estimated activation from the authors' CMC Reach8 example. Not force, pain, fatigue, or patient data.\"}";
        }
        return output.str();
    }

    void loadBenchmark() {
        std::ifstream stream(benchmarkPath_);
        if (!stream) {
            throw std::runtime_error(
                "Official benchmark is missing: " + benchmarkPath_.string());
        }

        std::string line;
        int declaredRows = -1;
        int declaredColumns = -1;
        std::string degreesValue;
        bool foundEndHeader = false;
        while (std::getline(stream, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line == "endheader") {
                foundEndHeader = true;
                break;
            }
            const std::size_t equals = line.find('=');
            if (equals == std::string::npos) continue;
            const std::string key = line.substr(0, equals);
            const std::string value = line.substr(equals + 1);
            if (key == "nRows") declaredRows = std::stoi(value);
            if (key == "nColumns") declaredColumns = std::stoi(value);
            if (key == "inDegrees") degreesValue = value;
        }
        if (!foundEndHeader || declaredRows != 3997 || declaredColumns != 142 ||
                degreesValue != "no") {
            throw std::runtime_error(
                "Unexpected CMC benchmark header; expected 3997 x 142 radians");
        }
        if (!std::getline(stream, line)) {
            throw std::runtime_error("CMC benchmark column header is missing");
        }
        std::vector<std::string> columns;
        std::istringstream headerStream(line);
        for (std::string column; headerStream >> column;) {
            columns.push_back(column);
        }
        if (columns.size() != static_cast<std::size_t>(declaredColumns)) {
            throw std::runtime_error("CMC benchmark column count mismatch");
        }
        std::map<std::string, std::size_t> columnIndex;
        for (std::size_t index = 0; index < columns.size(); ++index) {
            if (!columnIndex.emplace(columns[index], index).second) {
                throw std::runtime_error(
                    "Duplicate CMC benchmark column: " + columns[index]);
            }
        }
        const auto requiredColumn = [&](const std::string& name) {
            const auto found = columnIndex.find(name);
            if (found == columnIndex.end()) {
                throw std::runtime_error(
                    "Required CMC benchmark column is missing: " + name);
            }
            return found->second;
        };
        const std::size_t timeColumn = requiredColumn("time");
        std::array<std::size_t, kPoseCoordinates.size()> coordinateColumns{};
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            coordinateColumns[index] = requiredColumn(
                kPoseCoordinates[index].benchmarkColumn);
        }
        std::vector<std::size_t> activationColumns;
        const auto& muscles = model_->getMuscles();
        activationColumns.reserve(static_cast<std::size_t>(muscles.getSize()));
        for (int index = 0; index < muscles.getSize(); ++index) {
            activationColumns.push_back(requiredColumn(
                "/forceset/" + muscles.get(index).getName() + "/activation"));
        }

        benchmarkFrames_.clear();
        benchmarkFrames_.reserve(static_cast<std::size_t>(declaredRows));
        benchmarkActivationMin_ = std::numeric_limits<double>::infinity();
        benchmarkActivationMax_ = -std::numeric_limits<double>::infinity();
        std::vector<double> values;
        values.reserve(columns.size());
        while (std::getline(stream, line)) {
            std::istringstream row(line);
            values.clear();
            for (double value = 0.0; row >> value;) values.push_back(value);
            if (values.empty()) continue;
            if (values.size() != columns.size()) {
                throw std::runtime_error("CMC benchmark row width mismatch");
            }
            BenchmarkFrame frame;
            frame.time = values[timeColumn];
            for (std::size_t index = 0; index < coordinateColumns.size(); ++index) {
                frame.coordinateRadians[index] = values[coordinateColumns[index]];
            }
            frame.activations.reserve(activationColumns.size());
            for (const std::size_t column : activationColumns) {
                const double activation = values[column];
                if (!std::isfinite(activation) || activation < -1e-9 ||
                        activation > 1.0 + 1e-9) {
                    throw std::runtime_error(
                        "CMC activation lies outside the expected 0-1 range");
                }
                frame.activations.push_back(activation);
                benchmarkActivationMin_ = std::min(
                    benchmarkActivationMin_, activation);
                benchmarkActivationMax_ = std::max(
                    benchmarkActivationMax_, activation);
            }
            if (!std::isfinite(frame.time) ||
                    (!benchmarkFrames_.empty() &&
                     frame.time <= benchmarkFrames_.back().time)) {
                throw std::runtime_error(
                    "CMC benchmark time must be finite and strictly increasing");
            }
            benchmarkFrames_.push_back(std::move(frame));
        }
        if (benchmarkFrames_.size() != static_cast<std::size_t>(declaredRows) ||
                benchmarkFrames_.front().activations.size() !=
                    static_cast<std::size_t>(muscleCount()) ||
                std::abs(benchmarkFrames_.front().time - 0.62) > 1e-9 ||
                std::abs(benchmarkFrames_.back().time - 4.34) > 1e-9 ||
                benchmarkActivationMin_ < -1e-9 ||
                benchmarkActivationMax_ > 1.0 + 1e-9) {
            throw std::runtime_error("CMC benchmark inventory validation failed");
        }
    }

    void applyBenchmarkFrame(const BenchmarkFrame& frame) {
        state_ = defaultState_;
        for (std::size_t index = 0; index < kPoseCoordinates.size(); ++index) {
            auto& coordinate = model_->updCoordinateSet().get(
                kPoseCoordinates[index].name);
            coordinate.setValue(state_, frame.coordinateRadians[index], false);
        }
        model_->assemble(state_);
        model_->realizePosition(state_);
    }

    void applyPose(const std::map<std::string, std::string>& query) {
        state_ = defaultState_;
        for (const auto& spec : kPoseCoordinates) {
            auto& coordinate = model_->updCoordinateSet().get(spec.name);
            const double requestedDegrees = queryNumber(query, spec.name).value_or(
                SimTK::convertRadiansToDegrees(coordinate.getDefaultValue()));
            const double requestedRadians = SimTK::convertDegreesToRadians(
                requestedDegrees);
            const double value = std::clamp(
                requestedRadians, coordinate.getRangeMin(), coordinate.getRangeMax());
            coordinate.setValue(state_, value, false);
        }
        // Set all independent coordinates first, then assemble once. This avoids
        // successively enforcing coupled shoulder/scapular constraints against
        // partially updated input values.
        model_->assemble(state_);
        model_->realizePosition(state_);
    }

    void validatePackage() const {
        if (bodyCount() != 12 || coordinateCount() != 26 ||
                muscleCount() != 50 || ligamentCount() != 4 || meshCount() != 33) {
            std::ostringstream message;
            message << "Official model inventory mismatch (bodies=" << bodyCount()
                    << ", coordinates=" << coordinateCount()
                    << ", muscles=" << muscleCount()
                    << ", ligaments=" << ligamentCount()
                    << ", meshes=" << meshCount() << ')';
            throw std::runtime_error(message.str());
        }
        std::set<std::string> filenames;
        for (const auto& mesh : model_->getComponentList<OpenSim::Mesh>()) {
            filenames.insert(mesh.getGeometryFilename());
            const auto file = geometryPath_ / mesh.getGeometryFilename();
            if (!std::filesystem::is_regular_file(file) ||
                    std::filesystem::file_size(file) == 0) {
                throw std::runtime_error("Official mesh is missing: " + file.string());
            }
        }
        if (filenames.size() != 33) {
            throw std::runtime_error("Expected 33 unique authored mesh files");
        }
        if (!model_->getMuscles().contains("BIClong") ||
                !model_->getMuscles().contains("BICshort")) {
            throw std::runtime_error("Expected authored biceps muscle paths are missing");
        }
    }

    std::filesystem::path modelPath_;
    std::filesystem::path geometryPath_;
    std::filesystem::path benchmarkPath_;
    std::unique_ptr<OpenSim::Model> model_;
    SimTK::State defaultState_;
    SimTK::State state_;
    std::unique_ptr<OpenSim::Model> staticModel_;
    SimTK::State staticDefaultState_;
    std::vector<std::string> staticAccelerationCoordinateNames_;
    double staticMuscleControlMinimum_{0.0};
    double staticMuscleControlMaximum_{1.0};
    std::vector<BenchmarkFrame> benchmarkFrames_;
    double benchmarkActivationMin_{0.0};
    double benchmarkActivationMax_{0.0};
};

bool isSafeModelAssetPath(std::string_view path) {
    constexpr std::string_view prefix = "/models/mobl_arms/Geometry/";
    if (!path.starts_with(prefix) || path.size() <= prefix.size()) return false;
    if (path.find("..") != std::string_view::npos ||
            path.find('\\') != std::string_view::npos ||
            path.find('%') != std::string_view::npos) {
        return false;
    }
    return path.ends_with(".vtp") &&
        path.find('/', prefix.size()) == std::string_view::npos;
}

HttpResponse routeRequest(const std::string& method, const std::string& target,
                          const std::filesystem::path& webRoot,
                          ModelExplorer& explorer) {
    if (method != "GET") {
        return {405, "Method Not Allowed", "application/json; charset=utf-8",
                "{\"error\":\"Only GET is supported\"}"};
    }

    const std::size_t queryStart = target.find('?');
    const std::string path = target.substr(0, queryStart);
    const std::string_view queryText = queryStart == std::string::npos
        ? std::string_view{} : std::string_view(target).substr(queryStart + 1);

    try {
        if (path == "/api/health") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.healthJson()};
        }
        if (path == "/api/model") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.modelJson()};
        }
        if (path == "/api/pose") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.poseJson(parseQuery(queryText))};
        }
        if (path == "/api/static-hold") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.staticHoldingJson(parseQuery(queryText))};
        }
        if (path == "/api/benchmark") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.benchmarkJson()};
        }
        if (path == "/api/benchmark/poses") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.benchmarkPosesJson()};
        }
        if (path == "/api/benchmark/frame") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.benchmarkFrameJson(parseQuery(queryText))};
        }
        if (path == "/api/benchmark/nearest") {
            return {200, "OK", "application/json; charset=utf-8",
                    explorer.benchmarkNearestJson(parseQuery(queryText))};
        }

        std::filesystem::path resolved;
        if (path == "/" || path == "/index.html") {
            resolved = webRoot / "index.html";
        } else if (path == "/app.js") {
            resolved = webRoot / "app.js";
        } else if (path == "/styles.css") {
            resolved = webRoot / "styles.css";
        } else if (path == "/vendor/three.module.min.js") {
            resolved = webRoot / "vendor/three.module.min.js";
        } else if (path == "/vendor/three.core.min.js") {
            resolved = webRoot / "vendor/three.core.min.js";
        } else if (isSafeModelAssetPath(path)) {
            resolved = webRoot / path.substr(1);
        } else {
            return {404, "Not Found", "application/json; charset=utf-8",
                    "{\"error\":\"Not found\"}"};
        }
        return {200, "OK", mimeType(resolved), readFile(resolved)};
    } catch (const std::invalid_argument& error) {
        return {400, "Bad Request", "application/json; charset=utf-8",
                "{\"error\":\"Invalid request\",\"detail\":\"" +
                    jsonEscape(error.what()) + "\"}"};
    } catch (const std::exception& error) {
        return {500, "Internal Server Error", "application/json; charset=utf-8",
                "{\"error\":\"Request failed\",\"detail\":\"" +
                    jsonEscape(error.what()) + "\"}"};
    }
}

void sendAll(int socketFd, const std::string& data) {
    std::size_t sent = 0;
    while (sent < data.size()) {
        const ssize_t count = ::send(
            socketFd, data.data() + sent, data.size() - sent, MSG_NOSIGNAL);
        if (count <= 0) return;
        sent += static_cast<std::size_t>(count);
    }
}

void handleClient(int clientFd, const std::filesystem::path& webRoot,
                  ModelExplorer& explorer) {
    std::string request;
    request.reserve(4096);
    char buffer[4096];
    while (request.find("\r\n\r\n") == std::string::npos &&
           request.size() < 16384) {
        const ssize_t count = ::recv(clientFd, buffer, sizeof(buffer), 0);
        if (count <= 0) return;
        request.append(buffer, static_cast<std::size_t>(count));
    }

    std::istringstream lineStream(request.substr(0, request.find("\r\n")));
    std::string method;
    std::string target;
    std::string protocol;
    lineStream >> method >> target >> protocol;

    HttpResponse response;
    if (method.empty() || target.empty()) {
        response = {400, "Bad Request", "application/json; charset=utf-8",
                    "{\"error\":\"Malformed request\"}"};
    } else {
        response = routeRequest(method, target, webRoot, explorer);
    }

    std::ostringstream headers;
    headers << "HTTP/1.1 " << response.status << ' ' << response.reason << "\r\n";
    headers << "Content-Type: " << response.contentType << "\r\n";
    headers << "Content-Length: " << response.body.size() << "\r\n";
    headers << "Cache-Control: no-store\r\n";
    headers << "X-Content-Type-Options: nosniff\r\n";
    headers << "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self';\r\n";
    headers << "Connection: close\r\n\r\n";
    sendAll(clientFd, headers.str());
    sendAll(clientFd, response.body);
}

void signalHandler(int) {
    g_running = false;
}

int runServer(int port, const std::filesystem::path& webRoot,
              ModelExplorer& explorer) {
    const int serverFd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) throw std::runtime_error("socket() failed");

    int reuse = 1;
    ::setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(static_cast<uint16_t>(port));

    if (::bind(serverFd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        const std::string message = std::string("bind() failed: ") +
            std::strerror(errno);
        ::close(serverFd);
        throw std::runtime_error(message);
    }
    if (::listen(serverFd, 32) < 0) {
        ::close(serverFd);
        throw std::runtime_error("listen() failed");
    }

    std::cout << "MoBL-ARMS upper-extremity explorer listening on 0.0.0.0:"
              << port << std::endl;
    while (g_running) {
        const int clientFd = ::accept(serverFd, nullptr, nullptr);
        if (clientFd < 0) {
            if (errno == EINTR) continue;
            break;
        }
        timeval clientTimeout{};
        clientTimeout.tv_sec = 1;
        ::setsockopt(clientFd, SOL_SOCKET, SO_RCVTIMEO,
                     &clientTimeout, sizeof(clientTimeout));
        ::setsockopt(clientFd, SOL_SOCKET, SO_SNDTIMEO,
                     &clientTimeout, sizeof(clientTimeout));
        handleClient(clientFd, webRoot, explorer);
        ::close(clientFd);
    }
    ::close(serverFd);
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    int port = 8080;
    bool selfTest = false;
    std::filesystem::path webRoot = "/workspace/public";
    std::filesystem::path modelPath = kModelPath;
    std::filesystem::path geometryPath = kGeometryPath;
    std::filesystem::path benchmarkPath = kBenchmarkPath;

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--port" && index + 1 < argc) {
            port = std::stoi(argv[++index]);
        } else if (argument == "--web-root" && index + 1 < argc) {
            webRoot = argv[++index];
        } else if (argument == "--model" && index + 1 < argc) {
            modelPath = argv[++index];
        } else if (argument == "--geometry" && index + 1 < argc) {
            geometryPath = argv[++index];
        } else if (argument == "--benchmark" && index + 1 < argc) {
            benchmarkPath = argv[++index];
        } else if (argument == "--self-test") {
            selfTest = true;
        } else {
            std::cerr << "Unknown argument: " << argument << std::endl;
            return 2;
        }
    }

    try {
        if (!std::filesystem::exists(webRoot / "index.html")) {
            throw std::runtime_error(
                "Web root is missing index.html: " + webRoot.string());
        }
        ModelExplorer explorer(modelPath, geometryPath, benchmarkPath);
        if (selfTest) {
            std::cout << explorer.selfTestJson() << std::endl;
            return 0;
        }
        if (port < 1 || port > 65535) {
            throw std::runtime_error("Port is out of range");
        }
        std::signal(SIGINT, signalHandler);
        std::signal(SIGTERM, signalHandler);
        std::signal(SIGPIPE, SIG_IGN);
        return runServer(port, webRoot, explorer);
    } catch (const std::exception& error) {
        std::cerr << "Fatal: " << error.what() << std::endl;
        return 1;
    }
}
