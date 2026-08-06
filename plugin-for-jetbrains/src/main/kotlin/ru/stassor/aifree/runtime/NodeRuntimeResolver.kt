package ru.stassor.aifree.runtime

import com.intellij.openapi.util.SystemInfo
import java.io.File
import java.util.concurrent.TimeUnit

object NodeRuntimeResolver {
    private const val REQUIRED_MAJOR = 18

    fun resolve(environment: Map<String, String> = System.getenv()): String {
        val attempts = candidates(environment).distinct().mapNotNull { candidate ->
            probe(candidate)?.let { candidate to it }
        }
        return attempts.firstOrNull { (_, major) -> major >= REQUIRED_MAJOR }?.first
            ?: error(
                "Node.js $REQUIRED_MAJOR+ не найден. Установите Node.js или задайте AI_FREE_NODE_PATH."
            )
    }

    internal fun candidates(environment: Map<String, String>): List<String> {
        val executable = if (SystemInfo.isWindows) "node.exe" else "node"
        val paths = mutableListOf<String>()
        environment["AI_FREE_NODE_PATH"]?.takeIf(String::isNotBlank)?.let(paths::add)
        environment["PATH"]
            ?.split(File.pathSeparator)
            ?.filter(String::isNotBlank)
            ?.mapTo(paths) { File(it, executable).path }

        if (SystemInfo.isWindows) {
            environment["ProgramFiles"]?.let { paths += File(it, "nodejs/node.exe").path }
            environment["LOCALAPPDATA"]?.let { paths += File(it, "Programs/nodejs/node.exe").path }
        } else {
            paths += listOf("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node")
        }
        paths += executable
        return paths
    }

    private fun probe(command: String): Int? = runCatching {
        val process = ProcessBuilder(command, "--version").redirectErrorStream(true).start()
        if (!process.waitFor(5, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            return null
        }
        if (process.exitValue() != 0) return null
        val version = process.inputStream.bufferedReader().use { it.readText() }.trim()
        Regex("^v(\\d+)\\.").find(version)?.groupValues?.get(1)?.toIntOrNull()
    }.getOrNull()
}
