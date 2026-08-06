package ru.stassor.aifree.runtime

data class BackendHandle(
    val port: Int,
    val process: Process,
) {
    val url: String = "http://127.0.0.1:$port/"
}
