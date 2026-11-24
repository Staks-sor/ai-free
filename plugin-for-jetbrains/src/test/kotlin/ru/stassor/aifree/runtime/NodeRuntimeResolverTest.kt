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

    @Test
    fun `rejects Node 20 and falls back to Node 22`() {
        val majors = mapOf("/node20" to 20, "/node22" to 22)

        val selected = NodeRuntimeResolver.firstCompatible(
            listOf("/node20", "/node22"),
            majors::get
        )

        assertEquals("/node22", selected)
    }
}
