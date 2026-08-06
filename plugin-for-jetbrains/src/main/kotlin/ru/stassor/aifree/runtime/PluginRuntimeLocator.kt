package ru.stassor.aifree.runtime

import java.nio.file.Path

object PluginRuntimeLocator {
    fun resolve(anchor: Class<*>): Path {
        val location = anchor.protectionDomain?.codeSource?.location
            ?: error("Не удалось определить расположение AI Free plugin JAR")
        return resolve(Path.of(location.toURI()))
    }

    internal fun resolve(codeSource: Path): Path {
        val libDirectory = codeSource.toAbsolutePath().normalize().parent
            ?: error("Не удалось определить каталог библиотек AI Free: $codeSource")
        val pluginDirectory = libDirectory.parent
            ?: error("Не удалось определить каталог AI Free plugin: $codeSource")
        return pluginDirectory.resolve("runtime")
    }
}
