package ru.stassor.aifree.runtime

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NodeRuntimeResolverTest {
    @Test
    fun `explicit node path is preferred`() {
        val candidates = NodeRuntimeResolver.candidates(
            mapOf("AI_FREE_NODE_PATH" to "/custom/node", "PATH" to "/usr/bin")
        )

        assertEquals("/custom/node", candidates.first())
    }

    @Test
    fun `path candidates retain node executable name`() {
        val candidates = NodeRuntimeResolver.candidates(mapOf("PATH" to "/first:/second"))

        assertTrue(candidates.any { it.contains("first") && it.endsWith("node") })
    }
}
