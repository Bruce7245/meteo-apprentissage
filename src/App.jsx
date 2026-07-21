import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Grid,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react'

const LEVELS = {
  green: { label: 'Vert', color: '#2f9e44', bg: '#eaf7ed' },
  yellow: { label: 'Jaune', color: '#b7791f', bg: '#fff8db' },
  orange: { label: 'Orange', color: '#c05621', bg: '#fff0e6' },
  red: { label: 'Rouge', color: '#c53030', bg: '#ffe8e8' },
}

const DEPARTMENTS = [
  { code: '72', name: 'Sarthe', level: 'orange', offers: 237, companies: 16910, formations: 636 },
  { code: '75', name: 'Paris', level: 'red', offers: 447, companies: 48230, formations: 1214 },
  { code: '69', name: 'Rhône', level: 'orange', offers: 440, companies: 31120, formations: 984 },
  { code: '13', name: 'Bouches-du-Rhône', level: 'orange', offers: 438, companies: 29750, formations: 872 },
  { code: '01', name: 'Ain', level: 'red', offers: 292, companies: 14240, formations: 418 },
  { code: '44', name: 'Loire-Atlantique', level: 'yellow', offers: 361, companies: 24180, formations: 744 },
  { code: '35', name: 'Ille-et-Vilaine', level: 'green', offers: 318, companies: 19800, formations: 690 },
  { code: '49', name: 'Maine-et-Loire', level: 'yellow', offers: 205, companies: 15120, formations: 512 },
]

function Metric({ label, value }) {
  return (
    <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="2xl" p="5">
      <Text color="gray.500" fontSize="sm">{label}</Text>
      <Text mt="1" fontSize="2xl" fontWeight="800" color="#17324d">{value.toLocaleString('fr-FR')}</Text>
    </Box>
  )
}

function App() {
  const [selectedCode, setSelectedCode] = useState('72')
  const selected = useMemo(
    () => DEPARTMENTS.find((department) => department.code === selectedCode) ?? DEPARTMENTS[0],
    [selectedCode],
  )
  const selectedLevel = LEVELS[selected.level]

  return (
    <Box minH="100vh" bg="#f4f7fa">
      <Box bg="#17324d" color="white" py={{ base: '8', md: '12' }}>
        <Container maxW="7xl">
          <Text color="#9fd3ff" fontWeight="900" letterSpacing="0.16em">APPRENTIFR</Text>
          <Heading mt="3" fontSize={{ base: '4xl', md: '6xl' }} maxW="900px">
            La météo quotidienne de l’apprentissage
          </Heading>
          <Text mt="5" maxW="760px" color="#d9e8f5" fontSize="lg" lineHeight="1.8">
            Une lecture départementale des entreprises, des offres, des formations et des tensions du marché.
          </Text>
        </Container>
      </Box>

      <Container maxW="7xl" py={{ base: '6', md: '10' }}>
        <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.35fr) minmax(320px, 0.65fr)' }} gap="6">
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="3xl" p={{ base: '5', md: '7' }}>
            <Flex justify="space-between" align="center" gap="4" wrap="wrap">
              <Box>
                <Text color="#457b9d" fontWeight="900" fontSize="sm">CARTE INTERACTIVE</Text>
                <Heading mt="1" color="#17324d" fontSize="2xl">Vigilance par département</Heading>
              </Box>
              <Badge px="3" py="2" borderRadius="full" bg="#edf6ff" color="#24557a">
                Données de démonstration
              </Badge>
            </Flex>

            <SimpleGrid mt="7" columns={{ base: 2, sm: 3, md: 4 }} gap="3">
              {DEPARTMENTS.map((department) => {
                const level = LEVELS[department.level]
                const active = department.code === selectedCode
                return (
                  <Button
                    key={department.code}
                    h="94px"
                    p="3"
                    borderRadius="2xl"
                    border="2px solid"
                    borderColor={active ? '#17324d' : level.color}
                    bg={level.bg}
                    color="#17324d"
                    onClick={() => setSelectedCode(department.code)}
                    _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
                  >
                    <Stack gap="0" align="center">
                      <Text fontSize="2xl" fontWeight="900">{department.code}</Text>
                      <Text fontSize="xs" lineClamp="1">{department.name}</Text>
                    </Stack>
                  </Button>
                )
              })}
            </SimpleGrid>

            <Flex mt="7" gap="3" wrap="wrap">
              {Object.entries(LEVELS).map(([key, level]) => (
                <Flex key={key} align="center" gap="2">
                  <Box boxSize="3" borderRadius="full" bg={level.color} />
                  <Text fontSize="sm" color="gray.600">{level.label}</Text>
                </Flex>
              ))}
            </Flex>
          </Box>

          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="3xl" p={{ base: '5', md: '7' }}>
            <Text color="#457b9d" fontWeight="900" fontSize="sm">BULLETIN LOCAL</Text>
            <Flex mt="3" justify="space-between" align="start" gap="4">
              <Box>
                <Heading color="#17324d" fontSize="3xl">{selected.name}</Heading>
                <Text mt="1" color="gray.500">Département {selected.code}</Text>
              </Box>
              <Badge px="4" py="2" borderRadius="full" bg={selectedLevel.bg} color={selectedLevel.color}>
                {selectedLevel.label}
              </Badge>
            </Flex>

            <SimpleGrid mt="7" columns={1} gap="3">
              <Metric label="Offres actives" value={selected.offers} />
              <Metric label="Entreprises employeuses" value={selected.companies} />
              <Metric label="Formations recensées" value={selected.formations} />
            </SimpleGrid>

            <Box mt="6" p="5" borderRadius="2xl" bg="#f7fafc">
              <Text fontWeight="800" color="#17324d">Lecture provisoire</Text>
              <Text mt="2" color="gray.600" lineHeight="1.7">
                Le moteur final combinera volumes d’offres, densité d’entreprises, saisonnalité, secteurs et fiabilité des sources.
              </Text>
            </Box>
          </Box>
        </Grid>
      </Container>
    </Box>
  )
}

export default App
