#include "ZipUtils.hpp"
#include <fstream>
#include <vector>
#include <string>
#include <zlib.h>

namespace lehra::utils {

namespace {

void writeU16(std::ofstream& out, uint16_t val) {
    char buf[2] = { static_cast<char>(val & 0xFF), static_cast<char>((val >> 8) & 0xFF) };
    out.write(buf, 2);
}

void writeU32(std::ofstream& out, uint32_t val) {
    char buf[4] = {
        static_cast<char>(val & 0xFF),
        static_cast<char>((val >> 8) & 0xFF),
        static_cast<char>((val >> 16) & 0xFF),
        static_cast<char>((val >> 24) & 0xFF)
    };
    out.write(buf, 4);
}

struct ZipFileEntry {
    std::string filename;
    uint32_t crc;
    uint32_t size;
    uint32_t localHeaderOffset;
};

} // anonymous namespace

bool ZipUtils::createStemsZip(const std::filesystem::path& sourceDir, const std::filesystem::path& zipPath) {
    try {
        if (!std::filesystem::exists(sourceDir) || !std::filesystem::is_directory(sourceDir)) {
            return false;
        }

        std::ofstream out(zipPath, std::ios::binary | std::ios::trunc);
        if (!out.is_open()) {
            return false;
        }

        std::vector<ZipFileEntry> entries;

        for (const auto& entry : std::filesystem::directory_iterator(sourceDir)) {
            if (!entry.is_regular_file()) continue;

            std::string filename = entry.path().filename().generic_string();
            std::ifstream in(entry.path(), std::ios::binary);
            if (!in.is_open()) continue;

            in.seekg(0, std::ios::end);
            size_t fileSize = static_cast<size_t>(in.tellg());
            in.seekg(0, std::ios::beg);

            std::vector<char> buffer(fileSize);
            if (fileSize > 0) {
                in.read(buffer.data(), fileSize);
            }
            in.close();

            uint32_t crc = static_cast<uint32_t>(crc32(0L, Z_NULL, 0));
            if (fileSize > 0) {
                crc = static_cast<uint32_t>(crc32(crc, reinterpret_cast<const Bytef*>(buffer.data()), static_cast<uInt>(fileSize)));
            }

            uint32_t localOffset = static_cast<uint32_t>(out.tellp());

            // ── Local File Header ──────────────────────────────────────────
            writeU32(out, 0x04034b50); // Signature
            writeU16(out, 20);         // Version needed to extract
            writeU16(out, 0);          // General purpose bit flag
            writeU16(out, 0);          // Compression method (0 = STORE)
            writeU32(out, 0);          // File last mod time/date
            writeU32(out, crc);        // CRC-32
            writeU32(out, static_cast<uint32_t>(fileSize)); // Compressed size
            writeU32(out, static_cast<uint32_t>(fileSize)); // Uncompressed size
            writeU16(out, static_cast<uint16_t>(filename.length())); // Filename length
            writeU16(out, 0);          // Extra field length
            out.write(filename.data(), filename.length());

            if (fileSize > 0) {
                out.write(buffer.data(), fileSize);
            }

            entries.push_back({filename, crc, static_cast<uint32_t>(fileSize), localOffset});
        }

        uint32_t centralDirStart = static_cast<uint32_t>(out.tellp());

        // ── Central Directory Headers ──────────────────────────────────
        for (const auto& e : entries) {
            writeU32(out, 0x02014b50); // Signature
            writeU16(out, 20);         // Version made by
            writeU16(out, 20);         // Version needed to extract
            writeU16(out, 0);          // General purpose bit flag
            writeU16(out, 0);          // Compression method (0 = STORE)
            writeU32(out, 0);          // File last mod time/date
            writeU32(out, e.crc);      // CRC-32
            writeU32(out, e.size);     // Compressed size
            writeU32(out, e.size);     // Uncompressed size
            writeU16(out, static_cast<uint16_t>(e.filename.length())); // Filename length
            writeU16(out, 0);          // Extra field length
            writeU16(out, 0);          // File comment length
            writeU16(out, 0);          // Disk number start
            writeU16(out, 0);          // Internal file attributes
            writeU32(out, 0);          // External file attributes
            writeU32(out, e.localHeaderOffset); // Relative offset of local header
            out.write(e.filename.data(), e.filename.length());
        }

        uint32_t centralDirEnd = static_cast<uint32_t>(out.tellp());
        uint32_t centralDirSize = centralDirEnd - centralDirStart;
        uint16_t numEntries = static_cast<uint16_t>(entries.size());

        // ── End of Central Directory Record ────────────────────────────
        writeU32(out, 0x06054b50); // Signature
        writeU16(out, 0);          // Number of this disk
        writeU16(out, 0);          // Disk where central directory starts
        writeU16(out, numEntries); // Number of central directory records on this disk
        writeU16(out, numEntries); // Total number of central directory records
        writeU32(out, centralDirSize);  // Size of central directory
        writeU32(out, centralDirStart); // Offset of start of central directory
        writeU16(out, 0);          // Comment length

        out.close();
        return true;
    } catch (...) {
        return false;
    }
}

} // namespace lehra::utils
