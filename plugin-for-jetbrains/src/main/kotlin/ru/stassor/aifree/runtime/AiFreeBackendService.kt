package ru.stassor.aifree.runtime

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.AppExecutorUtil
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@Service(Service.Level.PROJECT)
class AiFreeBackendService(private val project: Project) : Disposable {
    private val log = Logger.getInstance(AiFreeBackendService::class.java)
    private val lock = Any()
    @Volatile private var handle: BackendHandle? = null
    @Volatile private var startup: CompletableFuture<BackendHandle>? = null

    fun start(): CompletableFuture<BackendHandle> = synchronized(lock) {
        handle?.takeIf { it.process.isAlive }?.let { return CompletableFuture.completedFuture(it) }
        startup?.takeIf { !it.isDone }?.let { return it }

        CompletableFuture.supplyAsync({ startBackend() }, AppExecutorUtil.getAppExecutorService())
            .also { future ->
                startup = future
                future.whenComplete { result, error ->
                    synchronized(lock) {
                        if (error == null) handle = result
                        startup = null
                    }
                }
            }
    }

    private fun startBackend(): BackendHandle {
        val runtimeRoot = PluginRuntimeLocator.resolve(AiFreeBackendService::class.java)
        val entrypoint = runtimeRoot.resolve("bin/deepseek.mjs")
        require(Files.isRegularFile(entrypoint)) { "AI Free runtime повреждён: нет $entrypoint" }

        val node = NodeRuntimeResolver.resolve()
        val port = findFreePort()
        val workspace = project.basePath ?: System.getProperty("user.home")
        val command = listOf(
            node,
            entrypoint.toString(),
            "--no-window",
            "--port", port.toString(),
            "--workspace", workspace,
        )
        log.info("Starting AI Free backend on 127.0.0.1:$port for $workspace")

        val process = ProcessBuilder(command)
            .directory(runtimeRoot.toFile())
            .redirectErrorStream(true)
            .apply {
                environment()["AI_FREE_JETBRAINS"] = "1"
                environment()["AI_FREE_LOG_SURFACE"] = "jetbrains"
                environment()["AI_FREE_DISABLE_TELEGRAM"] = "1"
            }
            .start()

        AppExecutorUtil.getAppExecutorService().execute {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { log.info("[backend] $it") }
            }
        }

        try {
            waitUntilReady(process, port)
        } catch (error: Throwable) {
            process.destroyForcibly()
            throw error
        }
        return BackendHandle(port, process)
    }

    private fun findFreePort(): Int = ServerSocket(0, 0, InetAddress.getLoopbackAddress()).use {
        it.localPort
    }

    private fun waitUntilReady(process: Process, port: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
        var lastError: Throwable? = null
        while (System.nanoTime() < deadline) {
            check(process.isAlive) { "AI Free backend завершился до запуска (code=${process.exitValue()})" }
            try {
                val connection = URI("http://127.0.0.1:$port/").toURL().openConnection() as HttpURLConnection
                connection.connectTimeout = 500
                connection.readTimeout = 500
                connection.requestMethod = "GET"
                connection.useCaches = false
                connection.inputStream.close()
                connection.disconnect()
                return
            } catch (error: Throwable) {
                lastError = error
                Thread.sleep(250)
            }
        }
        throw IllegalStateException("AI Free backend не запустился за 90 секунд", lastError)
    }

    override fun dispose() {
        synchronized(lock) {
            handle?.process?.takeIf(Process::isAlive)?.destroy()
            handle = null
        }
    }
}
