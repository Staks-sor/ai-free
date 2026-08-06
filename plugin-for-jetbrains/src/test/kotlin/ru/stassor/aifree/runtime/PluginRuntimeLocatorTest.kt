package ru.stassor.aifree.runtime

import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

class PluginRuntimeLocatorTest {
    @Test
    fun `runtime is resolved beside the plugin lib directory`() {
        val codeSource = Path.of("/plugins/ai-free-jetbrains/lib/ai-free-jetbrains.jar")

        assertEquals(
            Path.of("/plugins/ai-free-jetbrains/runtime"),
            PluginRuntimeLocator.resolve(codeSource),
        )
    }
}
