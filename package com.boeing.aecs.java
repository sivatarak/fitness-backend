package com.boeing.aecs.decisionmanagement.data.v2.models;

import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class V3BemsMappingTest {

    // Helper method to create test data
    private V3BemsMapping createBemsMapping(String bemsId, String bemsName, String bemsEmail,
                                             boolean notInDSEA, boolean notInAccessGroup,
                                             String consigneeId, String consigneeName,
                                             String status) {
        V3BemsMapping mapping = new V3BemsMapping();
        mapping.setBemsId(bemsId);
        mapping.setBemsName(bemsName);
        mapping.setBemsEmail(bemsEmail);
        mapping.setNotInDSEA(notInDSEA);
        mapping.setNotInAccessGroup(notInAccessGroup);
        mapping.setConsigneeId(consigneeId);
        mapping.setConsigneeName(consigneeName);
        mapping.setStatus(status);
        mapping.setAccessGroupDetails(new ArrayList<>());
        return mapping;
    }

    // ===================== V3BemsMapping Tests =====================

    @Test
    void testBemsMappingFieldsSetCorrectly() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS001", "John Doe", "john.doe@boeing.com",
                false, false, "CON001", "Boeing Defense UK Ltd", "Active"
        );
        assertEquals("BMS001", mapping.getBemsId());
        assertEquals("John Doe", mapping.getBemsName());
        assertEquals("john.doe@boeing.com", mapping.getBemsEmail());
        assertFalse(mapping.isNotInDSEA());
        assertFalse(mapping.isNotInAccessGroup());
        assertEquals("CON001", mapping.getConsigneeId());
        assertEquals("Boeing Defense UK Ltd", mapping.getConsigneeName());
        assertEquals("Active", mapping.getStatus());
    }

    @Test
    void testBemsMappingStatusActiveWhenConsigneeExists() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS001", "John Doe", "john.doe@boeing.com",
                false, false, "CON001", "Boeing Defense UK Ltd", "Active"
        );
        assertEquals("Active", mapping.getStatus());
    }

    @Test
    void testBemsMappingStatusInactiveWhenConsigneeNull() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS003", "Bob Brown", "bob.brown@boeing.com",
                true, true, null, null, "Inactive"
        );
        assertEquals("Inactive", mapping.getStatus());
    }

    @Test
    void testBemsMappingNotInDSEATrueWhenConsigneeNull() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS003", "Bob Brown", "bob.brown@boeing.com",
                true, true, null, null, "Inactive"
        );
        assertTrue(mapping.isNotInDSEA());
    }

    @Test
    void testBemsMappingNotInDSEAFalseWhenConsigneeExists() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS001", "John Doe", "john.doe@boeing.com",
                false, false, "CON001", "Boeing Defense UK Ltd", "Active"
        );
        assertFalse(mapping.isNotInDSEA());
    }

    @Test
    void testBemsMappingNotInAccessGroupTrueWhenAccessGroupNull() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS003", "Bob Brown", "bob.brown@boeing.com",
                true, true, null, null, "Inactive"
        );
        assertTrue(mapping.isNotInAccessGroup());
    }

    @Test
    void testBemsMappingNotInAccessGroupFalseWhenAccessGroupExists() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS001", "John Doe", "john.doe@boeing.com",
                false, false, "CON001", "Boeing Defense UK Ltd", "Active"
        );
        assertFalse(mapping.isNotInAccessGroup());
    }

    @Test
    void testAccessGroupDetailsEmptyByDefault() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS003", "Bob Brown", "bob.brown@boeing.com",
                true, true, null, null, "Inactive"
        );
        assertTrue(mapping.getAccessGroupDetails().isEmpty());
    }

    @Test
    void testAccessGroupDetailsAddedCorrectly() {
        V3BemsMapping mapping = createBemsMapping(
                "BMS001", "John Doe", "john.doe@boeing.com",
                false, false, "CON001", "Boeing Defense UK Ltd", "Active"
        );
        V3AccessGroupDetail detail = new V3AccessGroupDetail();
        detail.setAccessGroupId("AG_BOEING_001");
        detail.setAccessGroupName("PRIMARY");
        detail.setSystem("DSEA");
        mapping.getAccessGroupDetails().add(detail);

        assertEquals(1, mapping.getAccessGroupDetails().size());
        assertEquals("AG_BOEING_001", mapping.getAccessGroupDetails().get(0).getAccessGroupId());
        assertEquals("PRIMARY", mapping.getAccessGroupDetails().get(0).getAccessGroupName());
        assertEquals("DSEA", mapping.getAccessGroupDetails().get(0).getSystem());
    }

    // ===================== V3RecipientsResponse Tests =====================

    @Test
    void testRecipientsResponseCountNotInDSEA() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        bemsList.add(createBemsMapping("BMS001", "John Doe", "john.doe@boeing.com", false, false, "CON001", "Boeing Defense UK Ltd", "Active"));
        bemsList.add(createBemsMapping("BMS002", "Jane Smith", "jane.smith@boeing.com", false, false, "CON002", "Boeing Australia Pty", "Active"));
        bemsList.add(createBemsMapping("BMS003", "Bob Brown", "bob.brown@boeing.com", true, true, null, null, "Inactive"));

        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(1, response.getCount().get("NotInDSEA"));
    }

    @Test
    void testRecipientsResponseCountNotInAccessGroup() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        bemsList.add(createBemsMapping("BMS001", "John Doe", "john.doe@boeing.com", false, false, "CON001", "Boeing Defense UK Ltd", "Active"));
        bemsList.add(createBemsMapping("BMS002", "Jane Smith", "jane.smith@boeing.com", false, false, "CON002", "Boeing Australia Pty", "Active"));
        bemsList.add(createBemsMapping("BMS003", "Bob Brown", "bob.brown@boeing.com", true, true, null, null, "Inactive"));

        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(1, response.getCount().get("NotInAccessGroup"));
    }

    @Test
    void testRecipientsResponseDetailsSize() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        bemsList.add(createBemsMapping("BMS001", "John Doe", "john.doe@boeing.com", false, false, "CON001", "Boeing Defense UK Ltd", "Active"));
        bemsList.add(createBemsMapping("BMS002", "Jane Smith", "jane.smith@boeing.com", false, false, "CON002", "Boeing Australia Pty", "Active"));
        bemsList.add(createBemsMapping("BMS003", "Bob Brown", "bob.brown@boeing.com", true, true, null, null, "Inactive"));

        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(3, response.getDetails().size());
    }

    @Test
    void testRecipientsResponseEmptyList() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(0, response.getCount().get("notInDSEA"));
        assertEquals(0, response.getCount().get("notInAccessGroup"));
        assertTrue(response.getDetails().isEmpty());
    }

    @Test
    void testRecipientsResponseAllNotInDSEA() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        bemsList.add(createBemsMapping("BMS001", "John Doe", "john.doe@boeing.com", true, true, null, null, "Inactive"));
        bemsList.add(createBemsMapping("BMS002", "Jane Smith", "jane.smith@boeing.com", true, true, null, null, "Inactive"));

        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(2, response.getCount().get("NotInDSEA"));
    }

    @Test
    void testRecipientsResponseNoneNotInDSEA() {
        List<V3BemsMapping> bemsList = new ArrayList<>();
        bemsList.add(createBemsMapping("BMS001", "John Doe", "john.doe@boeing.com", false, false, "CON001", "Boeing Defense UK Ltd", "Active"));
        bemsList.add(createBemsMapping("BMS002", "Jane Smith", "jane.smith@boeing.com", false, false, "CON002", "Boeing Australia Pty", "Active"));

        V3RecipientsResponse response = V3RecipientsResponse.build(bemsList);

        assertEquals(0, response.getCount().get("NotInDSEA"));
    }
}