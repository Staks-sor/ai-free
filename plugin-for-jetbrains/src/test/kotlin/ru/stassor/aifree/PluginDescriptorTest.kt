package ru.stassor.aifree

import kotlin.test.Test
import kotlin.test.assertContains

class PluginDescriptorTest {
    @Test
    fun `declares the split JCEF module as an optional dependency`() {
        val descriptor = requireNotNull(javaClass.classLoader.getResource("META-INF/plugin.xml"))
            .readText()

        assertContains(
            descriptor,
            "<depends optional=\"true\" config-file=\"ai-free-jcef.xml\">com.intellij.modules.jcef</depends>",
        )
        requireNotNull(javaClass.classLoader.getResource("META-INF/ai-free-jcef.xml"))
    }
}
